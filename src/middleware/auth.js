const jwt = require("jsonwebtoken");
const env = require("../config/env");
const db = require("../config/db");
const { parsePermissions } = require("../utils/permissions");
const { passwordVersion } = require("./../utils/token");

// Verifies the JWT, then loads the user fresh from the DB so permission
// changes apply immediately (and deleted users are locked out).
module.exports = async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] });
  } catch {
    return res.status(401).json({ message: "Session expired, please login again" });
  }

  // Student tokens belong to the student portal only.
  if (payload.role === "student") return res.status(401).json({ message: "Unauthorized" });

  try {
    const [[user]] = await db.query(
      `SELECT id, name, email, phone, photo, password_hash, role_name, category, data_scope, permissions, is_super,
         (SELECT id FROM receptionists WHERE admin_id = admins.id LIMIT 1) AS receptionist_id
       FROM admins WHERE id = ?`,
      [payload.id],
    );
    if (!user) return res.status(401).json({ message: "Account not found, please login again" });
    if (payload.pv !== passwordVersion(user.password_hash)) {
      return res.status(401).json({ message: "Session expired, please login again" });
    }
    req.admin = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      photo: user.photo,
      category: user.category || "other",
      data_scope: user.is_super ? "all" : user.data_scope || "all",
      receptionist_id: user.receptionist_id || null,
      role_name: user.is_super ? "Super Admin" : user.role_name,
      is_super: Boolean(user.is_super),
      permissions: parsePermissions(user.permissions),
    };
    next();
  } catch (err) {
    next(err);
  }
};
