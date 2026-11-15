const fs = require("fs");
const path = require("path");
const db = require("../config/db");
const { certificatePath, removeCertificateFile } = require("../middleware/upload");
const { asyncHandler, httpError, requireFields } = require("../utils/http");

const SELECT = `SELECT c.id, c.student_id, c.title, c.code, c.original_name, c.file_path, c.created_at,
    s.student_code, CONCAT_WS(' ', s.first_name, s.last_name) AS student_name
  FROM certificates c JOIN students s ON s.id = c.student_id`;

const MIME = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const clean = (name) => String(name || "certificate").replace(/[^\w.\- ]+/g, "_").slice(0, 120);

const withKind = (r) => ({
  ...r,
  file_kind: path.extname(r.file_path).toLowerCase() === ".pdf" ? "pdf" : "image",
  file_path: undefined,
});

const list = asyncHandler(async (req, res) => {
  const { search, student_id } = req.query;
  const where = [];
  const params = [];
  if (search) {
    where.push("(c.title LIKE ? OR c.code LIKE ? OR s.student_code LIKE ? OR CONCAT_WS(' ', s.first_name, s.last_name) LIKE ?)");
    params.push(...Array(4).fill(`%${search}%`));
  }
  if (student_id) where.push("c.student_id = ?") && params.push(student_id);
  const [rows] = await db.query(`${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY c.id DESC`, params);
  res.json(rows.map(withKind));
});

async function readBody(req, { creating, id = 0 }) {
  requireFields(req.body, [
    ["title", "Certificate title"],
    ["code", "Certificate code"],
    ...(creating ? [["student_id", "Student"]] : []),
  ]);
  const code = String(req.body.code).trim();
  const [[clash]] = await db.query("SELECT id FROM certificates WHERE code = ? AND id <> ?", [code, id]);
  if (clash) throw httpError(400, "This certificate code is already used");
  return { title: String(req.body.title).trim(), code };
}

const create = asyncHandler(async (req, res) => {
  const file = req.file ? req.file.filename : null;
  try {
    if (!file) throw httpError(400, "Please attach the certificate file (PDF or image)");
    const values = await readBody(req, { creating: true });
    const [[student]] = await db.query("SELECT id FROM students WHERE id = ?", [req.body.student_id]);
    if (!student) throw httpError(404, "Student not found");
    const [r] = await db.query("INSERT INTO certificates SET ?", [
      { ...values, student_id: student.id, file_path: file, original_name: clean(req.file.originalname), created_by: req.admin.id },
    ]);
    res.status(201).json({ id: r.insertId });
  } catch (err) {
    removeCertificateFile(file);
    throw err;
  }
});

const update = asyncHandler(async (req, res) => {
  const file = req.file ? req.file.filename : null;
  try {
    const [[existing]] = await db.query("SELECT file_path FROM certificates WHERE id = ?", [req.params.id]);
    if (!existing) throw httpError(404, "Certificate not found");
    const values = await readBody(req, { creating: false, id: Number(req.params.id) });
    if (req.body.student_id) {
      const [[student]] = await db.query("SELECT id FROM students WHERE id = ?", [req.body.student_id]);
      if (!student) throw httpError(404, "Student not found");
      values.student_id = student.id;
    }
    if (file) {
      values.file_path = file;
      values.original_name = clean(req.file.originalname);
    }
    await db.query("UPDATE certificates SET ? WHERE id = ?", [values, req.params.id]);
    if (file) removeCertificateFile(existing.file_path); // a new file replaces (and deletes) the old one
    res.json({ id: Number(req.params.id) });
  } catch (err) {
    removeCertificateFile(file);
    throw err;
  }
});

const remove = asyncHandler(async (req, res) => {
  const [[row]] = await db.query("SELECT file_path FROM certificates WHERE id = ?", [req.params.id]);
  if (!row) throw httpError(404, "Certificate not found");
  await db.query("DELETE FROM certificates WHERE id = ?", [req.params.id]);
  removeCertificateFile(row.file_path);
  res.json({ success: true });
});

/** Send a certificate file (inline, or as a download with ?download=1). */
function sendFile(res, row, download) {
  const abs = certificatePath(row.file_path);
  if (!fs.existsSync(abs)) throw httpError(404, "File not found");
  const ext = path.extname(row.file_path).toLowerCase();
  const name = clean(row.original_name || `${row.code}${ext}`);
  res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
  res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${name}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.sendFile(abs);
}

const file = asyncHandler(async (req, res) => {
  const [[row]] = await db.query("SELECT file_path, original_name, code FROM certificates WHERE id = ?", [req.params.id]);
  if (!row) throw httpError(404, "Certificate not found");
  sendFile(res, row, req.query.download === "1");
});

// ── student portal: only the student's own certificates ──
const mine = asyncHandler(async (req, res) => {
  const [rows] = await db.query(`${SELECT} WHERE c.student_id = ? ORDER BY c.id DESC`, [req.student.id]);
  res.json(rows.map(withKind));
});

const mineFile = asyncHandler(async (req, res) => {
  const [[row]] = await db.query(
    "SELECT file_path, original_name, code FROM certificates WHERE id = ? AND student_id = ?",
    [req.params.id, req.student.id],
  );
  if (!row) throw httpError(404, "Certificate not found");
  sendFile(res, row, req.query.download === "1");
});

module.exports = { list, create, update, remove, file, mine, mineFile };
