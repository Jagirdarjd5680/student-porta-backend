const db = require("../config/db");
const { METHODS } = require("./payments.controller");
const { addOwn, assertOwned } = require("../utils/scope");
const {
  asyncHandler,
  httpError,
  requireFields,
  emptyToNull,
} = require("../utils/http");

const list = asyncHandler(async (req, res) => {
  const search = (req.query.search || "").trim();
  const where = [];
  const params = [];
  if (search) {
    where.push(`(s.student_code LIKE ? OR CONCAT_WS(' ', s.first_name, s.last_name) LIKE ?
      OR r.transaction_id LIKE ? OR r.description LIKE ? OR r.method LIKE ?)`);
    params.push(...Array(5).fill(`%${search}%`));
  }
  addOwn(req, "r", where, params);
  const [rows] = await db.query(
    `SELECT r.*, s.student_code, CONCAT_WS(' ', s.first_name, s.last_name) AS student_name
     FROM refunds r
     JOIN students s ON s.id = r.student_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY r.refund_date DESC, r.id DESC`,
    params,
  );
  res.json(rows);
});

const create = asyncHandler(async (req, res) => {
  requireFields(req.body, [
    ["student_id", "Student"],
    ["amount", "Refund Amount"],
    ["refund_date", "Refund Date"],
    ["method", "Payment Method"],
  ]);
  const b = req.body;
  await assertOwned(req, "students", b.student_id);
  const amount = Math.round(Number(b.amount) * 100) / 100;
  if (!(amount > 0)) throw httpError(400, "Refund Amount must be greater than 0");
  if (!METHODS.includes(b.method)) throw httpError(400, "Invalid payment method");

  // A refund cannot be more than what the student has paid (minus earlier refunds).
  const [[row]] = await db.query(
    `SELECT
       (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE student_id = ?) -
       (SELECT COALESCE(SUM(amount), 0) FROM refunds WHERE student_id = ?) AS refundable`,
    [b.student_id, b.student_id],
  );
  if (amount > Number(row.refundable) + 0.001) {
    throw httpError(
      400,
      `Refund cannot be more than refundable amount (₹${Number(row.refundable).toFixed(2)})`,
    );
  }

  const [r] = await db.query(
    `INSERT INTO refunds (student_id, amount, refund_date, method, transaction_id, description, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      b.student_id,
      amount,
      b.refund_date,
      b.method,
      emptyToNull(b.transaction_id),
      emptyToNull(b.description),
      req.admin.id,
    ],
  );
  res.status(201).json({ id: r.insertId });
});

module.exports = { list, create };
