const fs = require("fs");
const path = require("path");
const db = require("../config/db");
const env = require("../config/env");
const { asyncHandler, httpError } = require("../utils/http");

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" };
const NAME_RE = /^[A-Za-z0-9._-]{1,120}$/;

// Admins / staff may see every uploaded image. A student may only see their own photo
// and the images of study materials they are allowed to open.
async function allowed(req, name) {
  if (req.admin) return true;
  const { student } = req;
  const [[own]] = await db.query("SELECT id FROM students WHERE id = ? AND photo = ?", [student.id, name]);
  if (own) return true;
  if (!student.menus.includes("materials")) return false;
  const [[mat]] = await db.query("SELECT id FROM study_materials WHERE file_path = ? LIMIT 1", [name]);
  return Boolean(mat);
}

// GET /api/photos/:name  (needs an admin or student login token)
const photo = asyncHandler(async (req, res) => {
  const name = String(req.params.name);
  const ext = path.extname(name).toLowerCase();
  if (!NAME_RE.test(name) || !MIME[ext]) throw httpError(404, "Not found");
  if (!(await allowed(req, name))) throw httpError(404, "Not found");

  const abs = path.join(env.uploadDir, name);
  if (!fs.existsSync(abs)) throw httpError(404, "Not found");
  res.setHeader("Content-Type", MIME[ext]);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("Content-Disposition", "inline");
  res.sendFile(abs);
});

module.exports = { photo };
