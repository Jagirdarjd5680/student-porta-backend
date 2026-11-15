const db = require("../config/db");
const { addOwn, assertOwned } = require("../utils/scope");
const { nextInvoiceNo } = require("../utils/codes");
const {
  asyncHandler,
  httpError,
  requireFields,
  emptyToNull,
} = require("../utils/http");

const METHODS = ["UPI", "Net Banking", "Card", "Cash", "Other"];

const PAYMENT_SELECT = `
  SELECT p.*, s.student_code, CONCAT_WS(' ', s.first_name, s.last_name) AS student_name,
    c.name AS course_name
  FROM payments p
  JOIN students s ON s.id = p.student_id
  LEFT JOIN courses c ON c.id = s.course_id`;

const list = asyncHandler(async (req, res) => {
  const search = (req.query.search || "").trim();
  const where = [];
  const params = [];
  if (search) {
    where.push(`(p.invoice_no LIKE ? OR s.student_code LIKE ?
      OR CONCAT_WS(' ', s.first_name, s.last_name) LIKE ? OR c.name LIKE ?
      OR p.transaction_id LIKE ? OR p.method LIKE ?)`);
    params.push(...Array(6).fill(`%${search}%`));
  }
  addOwn(req, "p", where, params);
  const [rows] = await db.query(
    `${PAYMENT_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY p.payment_date DESC, p.id DESC`,
    params,
  );
  res.json(rows);
});

const create = asyncHandler(async (req, res) => {
  requireFields(req.body, [
    ["student_id", "Student"],
    ["amount", "Payment Amount"],
    ["payment_date", "Payment Date"],
    ["method", "Payment Method"],
  ]);
  const b = req.body;
  await assertOwned(req, "students", b.student_id);
  const amount = Math.round(Number(b.amount) * 100) / 100;
  if (!(amount > 0)) throw httpError(400, "Payment Amount must be greater than 0");
  if (!METHODS.includes(b.method)) throw httpError(400, "Invalid payment method");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    // Lock the student row so two payments can't exceed the balance together.
    const [[student]] = await conn.query(
      "SELECT id, total_fee FROM students WHERE id = ? FOR UPDATE",
      [b.student_id],
    );
    if (!student) throw httpError(404, "Student not found");

    const [[paid]] = await conn.query(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE student_id = ?",
      [b.student_id],
    );
    const balance = Number(student.total_fee) - Number(paid.total);
    if (amount > balance + 0.001) {
      throw httpError(
        400,
        `Amount cannot be more than remaining balance (₹${balance.toFixed(2)})`,
      );
    }

    const invoiceNo = await nextInvoiceNo(conn, b.payment_date);
    const [r] = await conn.query(
      `INSERT INTO payments (invoice_no, student_id, amount, payment_date, method, transaction_id, description, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceNo,
        b.student_id,
        amount,
        b.payment_date,
        b.method,
        emptyToNull(b.transaction_id),
        emptyToNull(b.description),
        req.admin.id,
      ],
    );
    await conn.commit();
    res.status(201).json({ id: r.insertId, invoice_no: invoiceNo });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

const remove = asyncHandler(async (req, res) => {
  const [r] = await db.query("DELETE FROM payments WHERE id = ?", [req.params.id]);
  if (!r.affectedRows) throw httpError(404, "Payment not found");
  res.json({ success: true });
});

/** Invoice data for one payment (optionally only if it belongs to `studentId`). */
async function loadInvoice(paymentId, studentId = null) {
  const [[payment]] = await db.query(
    `SELECT p.*, CONCAT_WS(' ', s.first_name, s.last_name) AS student_name,
       s.student_code, s.address AS student_address, s.phone AS student_phone,
       s.email AS student_email, c.name AS course_name
     FROM payments p
     JOIN students s ON s.id = p.student_id
     LEFT JOIN courses c ON c.id = s.course_id
     WHERE p.id = ?${studentId ? " AND p.student_id = ?" : ""}`,
    studentId ? [paymentId, studentId] : [paymentId],
  );
  if (!payment) throw httpError(404, "Payment not found");

  // Amount is GST inclusive (18% = 9% SGST + 9% CGST)
  const total = Number(payment.amount);
  const subTotal = Math.round((total / 1.18) * 100) / 100;
  const gst = Math.round((total - subTotal) * 100) / 100;
  const sgst = Math.round((gst / 2) * 100) / 100;
  const cgst = Math.round((gst - sgst) * 100) / 100;

  return {
    institute: await require("../services/settings").getInstitute(),
    payment,
    item: { name: payment.course_name, hsn: "9983", quantity: 1 },
    totals: { subTotal, sgst, cgst, total },
  };
}

const invoice = asyncHandler(async (req, res) => {
  res.json(await loadInvoice(req.params.id));
});

module.exports = { list, create, remove, invoice, loadInvoice, METHODS };
