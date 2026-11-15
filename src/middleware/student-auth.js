const jwt = require("jsonwebtoken");
const env = require("../config/env");
const db = require("../config/db");
const { parseMenus } = require("../utils/student-menus");

// Verifies a student token and loads the student fresh (so a changed password or
// removed menu applies immediately, and a deleted student is locked out).
module.exports = async function studentAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] });
  } catch {
    return res.status(401).json({ message: "Session expired, please login again" });
  }
  if (payload.role !== "student") return res.status(401).json({ message: "Unauthorized" });

  try {
    const [[s]] = await db.query(
      `SELECT id, student_code, first_name, last_name, portal_menus, token_version, password_hash
       FROM students WHERE id = ?`,
      [payload.id],
    );
    if (!s || !s.password_hash || s.token_version !== payload.tv) {
      return res.status(401).json({ message: "Session expired, please login again" });
    }
    req.student = {
      id: s.id,
      code: s.student_code,
      name: [s.first_name, s.last_name].filter(Boolean).join(" "),
      menus: parseMenus(s.portal_menus),
    };
    next();
  } catch (err) {
    next(err);
  }
};

/** Route guard: the student must be allowed this portal menu. */
module.exports.needMenu = (menu) => (req, res, next) =>
  req.student.menus.includes(menu)
    ? next()
    : res.status(403).json({ message: "You don't have access to this section" });
