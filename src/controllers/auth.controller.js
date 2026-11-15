const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const env = require("../config/env");
const { removeFile } = require("../middleware/upload");
const { asyncHandler, httpError, requireFields, cleanPhone } = require("../utils/http");
const { parsePermissions } = require("../utils/permissions");
const { passwordVersion } = require("../utils/token");

// Compared against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

const login = asyncHandler(async (req, res) => {
  requireFields(req.body, [
    ["email", "Email"],
    ["password", "Password"],
  ]);
  const [rows] = await db.query("SELECT * FROM admins WHERE email = ?", [
    String(req.body.email).trim().toLowerCase(),
  ]);
  const admin = rows[0];
  const ok = await bcrypt.compare(String(req.body.password), admin ? admin.password_hash : DUMMY_HASH);
  if (!admin || !ok) throw httpError(401, "Invalid email or password");

  const payload = { id: admin.id, name: admin.name, email: admin.email };
  // `pv` ties the token to the current password: changing it signs out every other session.
  const token = jwt.sign({ ...payload, pv: passwordVersion(admin.password_hash) }, env.jwtSecret, {
    algorithm: "HS256",
    expiresIn: env.jwtExpiresIn,
  });
  res.json({
    token,
    admin: {
      ...payload,
      phone: admin.phone,
      photo: admin.photo,
      role_name: admin.is_super ? "Super Admin" : admin.role_name,
      is_super: Boolean(admin.is_super),
      permissions: parsePermissions(admin.permissions),
    },
  });
});

const me = asyncHandler(async (req, res) => {
  res.json({ admin: req.admin });
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Edit my own profile: name, email, phone, photo (a new photo replaces and deletes the old file).
const updateProfile = asyncHandler(async (req, res) => {
  const newPhoto = req.file ? req.file.filename : null;
  try {
    const b = req.body;
    requireFields(b, [
      ["name", "Name"],
      ["email", "Email"],
    ]);
    const email = String(b.email).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw httpError(400, "Please enter a valid email");
    const [[clash]] = await db.query("SELECT id FROM admins WHERE email = ? AND id <> ?", [email, req.admin.id]);
    if (clash) throw httpError(400, "This email is already used by another user");

    const [[current]] = await db.query("SELECT photo FROM admins WHERE id = ?", [req.admin.id]);
    const values = { name: String(b.name).trim(), email, phone: cleanPhone(b.phone) };
    const dropPhoto = !newPhoto && b.remove_photo === "true";
    if (newPhoto) values.photo = newPhoto;
    else if (dropPhoto) values.photo = null;

    await db.query("UPDATE admins SET ? WHERE id = ?", [values, req.admin.id]);
    if (newPhoto || dropPhoto) removeFile(current.photo);
    const [[row]] = await db.query("SELECT name, email, phone, photo FROM admins WHERE id = ?", [req.admin.id]);
    res.json({ admin: { ...req.admin, ...row } });
  } catch (err) {
    removeFile(newPhoto);
    throw err;
  }
});

const changePassword = asyncHandler(async (req, res) => {
  requireFields(req.body, [
    ["current_password", "Current password"],
    ["new_password", "New password"],
  ]);
  const next = String(req.body.new_password);
  if (next.length < 8) throw httpError(400, "New password must be at least 8 characters");
  if (next !== String(req.body.confirm_password || "")) {
    throw httpError(400, "New password and Re-enter password do not match");
  }
  const [[row]] = await db.query("SELECT password_hash FROM admins WHERE id = ?", [req.admin.id]);
  if (!(await bcrypt.compare(String(req.body.current_password), row.password_hash))) {
    throw httpError(400, "Current password is wrong");
  }
  const hash = await bcrypt.hash(next, 10);
  await db.query("UPDATE admins SET password_hash = ? WHERE id = ?", [hash, req.admin.id]);
  // Other devices are signed out; this one gets a fresh token.
  const token = jwt.sign(
    { id: req.admin.id, name: req.admin.name, email: req.admin.email, pv: passwordVersion(hash) },
    env.jwtSecret,
    { algorithm: "HS256", expiresIn: env.jwtExpiresIn },
  );
  res.json({ success: true, token });
});

module.exports = { login, me, updateProfile, changePassword };
