// Wraps async route handlers so errors reach the error middleware.
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const isEmpty = (v) => v === undefined || v === null || String(v).trim() === "";

// fields: [["student_name", "Student Name"], ...] -> 400 if any is empty
function requireFields(body, fields) {
  const missing = fields.filter(([key]) => isEmpty(body[key]));
  if (missing.length) {
    const labels = missing.map(([, label]) => label).join(", ");
    throw httpError(400, `${labels} ${missing.length > 1 ? "are" : "is"} required`);
  }
}

const emptyToNull = (v) => (isEmpty(v) ? null : v);

// Mobile numbers are stored without leading zeros ("098..." -> "98...").
const cleanPhone = (v) => (isEmpty(v) ? null : String(v).trim().replace(/^0+/, "") || null);

const toNumber = (v) => (isEmpty(v) ? 0 : Number(v) || 0);

module.exports = {
  asyncHandler,
  httpError,
  requireFields,
  emptyToNull,
  toNumber,
  cleanPhone,
};
