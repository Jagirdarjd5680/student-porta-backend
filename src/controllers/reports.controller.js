const db = require("../config/db");
const { asyncHandler } = require("../utils/http");
const { addOwn } = require("../utils/scope");

// Builds WHERE for payments (alias p) or refunds (alias r) using the same filters.
function buildFilters(query, alias, dateColumn, req) {
  const { from, to, student, course_id, method } = query;
  const where = [];
  const params = [];
  if (from) where.push(`${alias}.${dateColumn} >= ?`) && params.push(from);
  if (to) where.push(`${alias}.${dateColumn} <= ?`) && params.push(to);
  if (student) {
    where.push(
      "(s.student_code LIKE ? OR CONCAT_WS(' ', s.first_name, s.last_name) LIKE ?)",
    );
    params.push(`%${student}%`, `%${student}%`);
  }
  if (course_id) where.push("s.course_id = ?") && params.push(course_id);
  if (method) where.push(`${alias}.method = ?`) && params.push(method);
  addOwn(req, alias, where, params);
  return {
    sql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

const payments = asyncHandler(async (req, res) => {
  const pf = buildFilters(req.query, "p", "payment_date", req);
  const [rows] = await db.query(
    `SELECT p.*, s.student_code, CONCAT_WS(' ', s.first_name, s.last_name) AS student_name,
       c.name AS course_name
     FROM payments p
     JOIN students s ON s.id = p.student_id
     LEFT JOIN courses c ON c.id = s.course_id
     ${pf.sql}
     ORDER BY p.payment_date DESC, p.id DESC`,
    pf.params,
  );

  const rf = buildFilters(req.query, "r", "refund_date", req);
  const [[refund]] = await db.query(
    `SELECT COALESCE(SUM(r.amount), 0) AS total, COUNT(*) AS count
     FROM refunds r JOIN students s ON s.id = r.student_id ${rf.sql}`,
    rf.params,
  );

  const totalAmount = rows.reduce((sum, r) => sum + Number(r.amount), 0);
  const totalRefunds = Number(refund.total);

  res.json({
    summary: {
      totalPayments: rows.length,
      totalAmount,
      totalRefunds,
      refundCount: Number(refund.count),
      netIncome: totalAmount - totalRefunds,
      averagePayment: rows.length ? totalAmount / rows.length : 0,
    },
    rows,
  });
});

module.exports = { payments };
