const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const env = require("../config/env");
const { STUDENT_SELECT } = require("../utils/student-sql");
const { parseMenus } = require("../utils/student-menus");
const { loadInvoice } = require("./payments.controller");
const { asyncHandler, httpError, requireFields } = require("../utils/http");

// ── Login (Student ID + password) ──────────────────────────────────────
// Simple in-memory brake: 8 wrong tries per Student ID + IP in 15 minutes.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRIES = 8;

function tooMany(key) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < WINDOW_MS);
  attempts.set(key, list);
  return list.length >= MAX_TRIES;
}
const fail = (key) => attempts.set(key, [...(attempts.get(key) || []), Date.now()]);

const login = asyncHandler(async (req, res) => {
  requireFields(req.body, [
    ["student_id", "Student ID"],
    ["password", "Password"],
  ]);
  const code = String(req.body.student_id).trim().toUpperCase();
  const key = `${req.ip}|${code}`;
  if (tooMany(key)) throw httpError(429, "Too many wrong attempts. Please try again after 15 minutes.");

  const [[s]] = await db.query("SELECT * FROM students WHERE UPPER(student_code) = ?", [code]);
  if (s && !s.password_hash) {
    throw httpError(403, "Your login is not set up yet. Please contact the institute.");
  }
  const ok = await bcrypt.compare(String(req.body.password), s && s.password_hash ? s.password_hash : DUMMY_HASH);
  if (!s || !ok) {
    fail(key);
    throw httpError(401, "Invalid Student ID or password");
  }
  attempts.delete(key);

  const name = [s.first_name, s.last_name].filter(Boolean).join(" ");
  const token = jwt.sign({ id: s.id, role: "student", tv: s.token_version }, env.jwtSecret, {
    algorithm: "HS256",
    expiresIn: env.jwtExpiresIn,
  });
  res.json({
    token,
    student: { id: s.id, name, student_code: s.student_code, menus: parseMenus(s.portal_menus) },
  });
});

// ── Own data (each block only if that menu is allowed) ─────────────────
const me = asyncHandler(async (req, res) => {
  const [[s]] = await db.query(`${STUDENT_SELECT} WHERE s.id = ?`, [req.student.id]);
  const [[course]] = await db.query(
    `SELECT c.name, c.description, cat.name AS category
     FROM courses c LEFT JOIN categories cat ON cat.id = c.category_id WHERE c.id = ?`,
    [s.course_id || 0],
  );
  const menus = req.student.menus;
  const [[inst]] = [[await require("../services/settings").getInstitute()]];

  res.json({
    menus,
    institute: { name: inst.name },
    student: {
      id: s.id,
      student_code: s.student_code,
      first_name: s.first_name,
      last_name: s.last_name,
      full_name: s.full_name,
      photo: s.photo,
    },
    profile: menus.includes("profile")
      ? {
          email: s.email,
          phone: s.phone,
          dob: s.dob,
          admission_date: s.admission_date,
          address: s.address,
        }
      : null,
    course: menus.includes("course")
      ? {
          name: course?.name || s.course_name,
          category: course?.category || null,
          description: course?.description || null,
          duration: s.duration_name,
          admission_date: s.admission_date,
        }
      : null,
    fees: menus.includes("payments")
      ? {
          course_fee: Number(s.course_fee),
          discount_type: s.discount_type,
          discount_value: Number(s.discount_value),
          discount_amount: Number(s.discount_amount),
          total_fee: Number(s.total_fee),
          total_paid: Number(s.total_paid),
          balance: Number(s.balance),
        }
      : null,
  });
});

const materials = asyncHandler(async (req, res) => {
  const [[s]] = await db.query("SELECT course_id, duration_id FROM students WHERE id = ?", [req.student.id]);
  if (!s?.course_id) return res.json([]);
  // Same course; same duration when the student has one.
  const [rows] = await db.query(
    `SELECT id, topic, material_type, title, content, file_path, created_at
     FROM study_materials
     WHERE course_id = ?${s.duration_id ? " AND duration_id = ?" : ""}
     ORDER BY topic, id DESC`,
    s.duration_id ? [s.course_id, s.duration_id] : [s.course_id],
  );
  res.json(rows);
});

const payments = asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    `SELECT id, invoice_no, amount, payment_date, method, transaction_id, description
     FROM payments WHERE student_id = ? ORDER BY payment_date DESC, id DESC`,
    [req.student.id],
  );
  res.json(rows);
});

const invoice = asyncHandler(async (req, res) => {
  res.json(await loadInvoice(req.params.id, req.student.id));
});

// ── Change own password ────────────────────────────────────────────────
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
  const [[s]] = await db.query("SELECT password_hash, token_version FROM students WHERE id = ?", [req.student.id]);
  if (!(await bcrypt.compare(String(req.body.current_password), s.password_hash))) {
    throw httpError(400, "Current password is wrong");
  }
  const tv = s.token_version + 1;
  await db.query("UPDATE students SET password_hash = ?, token_version = ? WHERE id = ?", [
    await bcrypt.hash(next, 10),
    tv,
    req.student.id,
  ]);
  // Other devices are signed out; this one gets a fresh token.
  const token = jwt.sign({ id: req.student.id, role: "student", tv }, env.jwtSecret, { algorithm: "HS256", expiresIn: env.jwtExpiresIn });
  res.json({ token });
});

module.exports = { login, me, materials, payments, invoice, changePassword };
