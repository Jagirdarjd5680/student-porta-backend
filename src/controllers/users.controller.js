const bcrypt = require("bcryptjs");
const { syncReceptionist: syncRec } = require("../utils/receptionists");
const syncReceptionist = (...args) => syncRec(db, ...args);
const { removeFile } = require("../middleware/upload");
const db = require("../config/db");
const { asyncHandler, httpError, requireFields, emptyToNull, cleanPhone } = require("../utils/http");
const { sanitizePermissions, parsePermissions, can, MODULES, ACTIONS } = require("../utils/permissions");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CATEGORIES = ["receptionist", "other"];
const readCategory = (v) => (CATEGORIES.includes(String(v)) ? String(v) : "other");
const readScope = (v) => (String(v) === "own" ? "own" : "all");

const toUser = (r) => ({
  id: r.id,
  name: r.name,
  email: r.email,
  phone: r.phone,
  role_name: r.is_super ? "Super Admin" : r.role_name,
  category: r.category || "other",
  data_scope: r.data_scope || "all",
  is_super: Boolean(r.is_super),
  permissions: parsePermissions(r.permissions),
  created_at: r.created_at,
});

const meta = asyncHandler(async (_req, res) => {
  res.json({ modules: MODULES, actions: ACTIONS });
});

const list = asyncHandler(async (_req, res) => {
  const [rows] = await db.query(
    "SELECT id, name, email, phone, role_name, category, data_scope, permissions, is_super, created_at FROM admins ORDER BY is_super DESC, id DESC",
  );
  res.json(rows.map(toUser));
});

function validate(b, { requirePassword }) {
  requireFields(b, [
    ["role_name", "Role Name"],
    ["name", "User Name"],
    ["email", "Email"],
    ...(requirePassword ? [["password", "Password"]] : []),
  ]);
  if (!EMAIL_RE.test(String(b.email).trim())) throw httpError(400, "Please enter a valid email");
  if (b.password && String(b.password).length < 8) {
    throw httpError(400, "Password must be at least 8 characters");
  }
}

async function emailTaken(email, exceptId = 0) {
  const [[row]] = await db.query("SELECT id FROM admins WHERE email = ? AND id <> ?", [email, exceptId]);
  return Boolean(row);
}

// Staff with the "roles" permission may manage other staff, but never beyond their own level:
//  - they cannot touch super admins (that would be an account takeover),
//  - they cannot change their own permissions,
//  - they can only hand out permissions they hold themselves.
function limitPermissions(req, input) {
  const wanted = sanitizePermissions(input);
  if (req.admin.is_super) return wanted;
  const out = {};
  for (const [mod, actions] of Object.entries(wanted)) {
    const allowed = actions.filter((a) => can(req.admin, mod, a));
    if (allowed.length) out[mod] = allowed;
  }
  return out;
}

const create = asyncHandler(async (req, res) => {
  const b = req.body;
  validate(b, { requirePassword: true });
  const email = String(b.email).trim().toLowerCase();
  if (await emailTaken(email)) throw httpError(400, "This email is already used by another user");

  const [r] = await db.query("INSERT INTO admins SET ?", [
    {
      name: String(b.name).trim(),
      email,
      phone: cleanPhone(b.phone),
      role_name: String(b.role_name).trim(),
      category: readCategory(b.category),
      data_scope: readScope(b.data_scope),
      permissions: JSON.stringify(limitPermissions(req, b.permissions)),
      is_super: 0,
      password_hash: await bcrypt.hash(String(b.password), 10),
    },
  ]);
  await syncReceptionist(r.insertId, String(b.name).trim(), readCategory(b.category) === "receptionist");
  res.status(201).json({ id: r.insertId });
});

const update = asyncHandler(async (req, res) => {
  const b = req.body;
  const id = Number(req.params.id);
  const [[existing]] = await db.query("SELECT id, is_super FROM admins WHERE id = ?", [id]);
  if (!existing) throw httpError(404, "User not found");
  if (existing.is_super && !req.admin.is_super) throw httpError(403, "Only a super admin can change a super admin");
  if (id === req.admin.id && !req.admin.is_super && b.permissions !== undefined) {
    // Everyone may save their own details, but not widen their own access.
    b.permissions = req.admin.permissions;
  }
  validate(b, { requirePassword: false });
  const email = String(b.email).trim().toLowerCase();
  if (await emailTaken(email, id)) throw httpError(400, "This email is already used by another user");

  const values = {
    name: String(b.name).trim(),
    email,
    phone: cleanPhone(b.phone),
    role_name: emptyToNull(b.role_name),
    category: readCategory(b.category),
    data_scope: readScope(b.data_scope),
  };
  // Super admins always keep full access; only staff permissions are editable.
  if (!existing.is_super) values.permissions = JSON.stringify(limitPermissions(req, b.permissions));
  if (b.password) values.password_hash = await bcrypt.hash(String(b.password), 10);

  await db.query("UPDATE admins SET ? WHERE id = ?", [values, id]);
  await syncReceptionist(id, values.name, values.category === "receptionist");
  res.json({ id });
});

const remove = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.admin.id) throw httpError(400, "You cannot delete your own account");
  const [[user]] = await db.query("SELECT is_super, photo FROM admins WHERE id = ?", [id]);
  if (!user) throw httpError(404, "User not found");
  if (user.is_super && !req.admin.is_super) throw httpError(403, "Only a super admin can delete a super admin");
  if (user.is_super) {
    const [[{ n }]] = await db.query("SELECT COUNT(*) AS n FROM admins WHERE is_super = 1");
    if (n <= 1) throw httpError(400, "The last super admin cannot be deleted");
  }
  await syncReceptionist(id, "", false); // old records keep the name, but no new selection
  await db.query("DELETE FROM admins WHERE id = ?", [id]);
  removeFile(user.photo);
  res.json({ success: true });
});

module.exports = { meta, list, create, update, remove };
