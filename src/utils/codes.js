const { toDdMmYy } = require("./dates");

// Next sequential code like INQ-0001, based on the highest existing one.
async function nextSequenceCode(conn, table, column, prefix, width = 4) {
  const [rows] = await conn.query(
    `SELECT ${column} AS code FROM ${table} WHERE ${column} LIKE ?
     ORDER BY CAST(SUBSTRING(${column}, ?) AS UNSIGNED) DESC LIMIT 1`,
    [`${prefix}%`, prefix.length + 1],
  );
  const last = rows[0] ? Number(rows[0].code.slice(prefix.length)) || 0 : 0;
  return `${prefix}${String(last + 1).padStart(width, "0")}`;
}

const nextInquiryNo = (conn) =>
  nextSequenceCode(conn, "inquiries", "inquiry_no", "INQ-");

const nextAdmissionNo = (conn) =>
  nextSequenceCode(conn, "admissions", "admission_no", "ADM-");

// INV-<ddmmyy>-<sequence of that day>
const nextInvoiceNo = (conn, paymentDate) =>
  nextSequenceCode(
    conn,
    "payments",
    "invoice_no",
    `INV-${toDdMmYy(paymentDate)}-`,
    3,
  );

// 2 letters of the name + 13 digits, e.g. ZS6181648477126
function makeStudentCode(firstName, lastName) {
  const first = String(firstName || "").replace(/[^a-z]/gi, "");
  const last = String(lastName || "").replace(/[^a-z]/gi, "");
  const letters = (first[0] || "X") + (last[0] || first[1] || "X");
  const digits = String(Date.now()).slice(-13).padStart(13, "0");
  return letters.toUpperCase() + digits;
}

module.exports = {
  nextInquiryNo,
  nextAdmissionNo,
  nextInvoiceNo,
  makeStudentCode,
};
