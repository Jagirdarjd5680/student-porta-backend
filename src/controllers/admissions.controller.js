const db = require("../config/db");
const { addOwn, ownClause, assertOwned, forcedReceptionist } = require("../utils/scope");
const { nextAdmissionNo } = require("../utils/codes");
const { toSqlDate } = require("../utils/dates");
const { removeFile, copyFile } = require("../middleware/upload");
const {
  asyncHandler,
  httpError,
  requireFields,
  emptyToNull,
  toNumber,
  cleanPhone,
} = require("../utils/http");

const ADMISSION_SELECT = `SELECT a.*, c.name AS course_name, r.name AS receptionist_name
     FROM admissions a
     LEFT JOIN courses c ON c.id = a.course_id
     LEFT JOIN receptionists r ON r.id = a.receptionist_id`;

const REQUIRED = [
  ["student_name", "Student Name"],
  ["phone", "Phone Number"],
  ["state", "State"],
  ["city", "City"],
  ["receptionist_id", "Receptionist"],
  ["course_id", "Course"],
];

const truthy = (v) => v === true || v === "true" || v === "1" || v === 1;

// Editable columns from a request body (create + update share this).
function fieldsFrom(b) {
  const offer = truthy(b.special_offer);
  return {
    student_name: b.student_name.trim(),
    father_name: emptyToNull(b.father_name),
    email: emptyToNull(b.email),
    phone: cleanPhone(b.phone),
    gender: emptyToNull(b.gender),
    dob: emptyToNull(b.dob),
    address: emptyToNull(b.address),
    state: b.state,
    city: b.city,
    zip_code: emptyToNull(b.zip_code),
    identity_proof: emptyToNull(b.identity_proof),
    identity_number: emptyToNull(b.identity_number),
    receptionist_id: b.receptionist_id,
    course_id: b.course_id,
    form_fees: toNumber(b.form_fees),
    admission_date: emptyToNull(b.admission_date) || toSqlDate(),
    special_offer: offer ? 1 : 0,
    special_offer_text: offer ? emptyToNull(b.special_offer_text) : null,
  };
}

const list = asyncHandler(async (req, res) => {
  const { search, status, from, to, course_id } = req.query;
  const where = [];
  const params = [];

  if (search) {
    where.push(
      "(a.admission_no LIKE ? OR a.student_name LIKE ? OR a.phone LIKE ? OR a.email LIKE ? OR a.father_name LIKE ?)",
    );
    params.push(...Array(5).fill(`%${search}%`));
  }
  if (status) where.push("a.status = ?") && params.push(status);
  if (from) where.push("a.admission_date >= ?") && params.push(from);
  if (to) where.push("a.admission_date <= ?") && params.push(to);
  if (course_id) where.push("a.course_id = ?") && params.push(course_id);
  addOwn(req, "a", where, params);

  const [rows] = await db.query(
    `${ADMISSION_SELECT}
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY a.id DESC`,
    params,
  );
  res.json(rows);
});

const stats = asyncHandler(async (req, res) => {
  const ow = ownClause(req, "") || { sql: "", params: [] };
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS total,
       SUM(status = 'Pending') AS pending,
       SUM(status = 'Confirmed') AS confirmed,
       SUM(admission_date = CURDATE()) AS today,
       SUM(YEARWEEK(admission_date, 1) = YEARWEEK(CURDATE(), 1)) AS this_week,
       COALESCE(SUM(form_fees), 0) AS total_form_fees
     FROM admissions ${ow.sql ? `WHERE ${ow.sql}` : ""}`,
    ow.params,
  );
  res.json({
    total: Number(row.total) || 0,
    pending: Number(row.pending) || 0,
    confirmed: Number(row.confirmed) || 0,
    today: Number(row.today) || 0,
    thisWeek: Number(row.this_week) || 0,
    totalFormFees: Number(row.total_form_fees) || 0,
  });
});

const getOne = asyncHandler(async (req, res) => {
  const [[row]] = await db.query(`${ADMISSION_SELECT} WHERE a.id = ?`, [req.params.id]);
  if (!row) throw httpError(404, "Admission not found");
  res.json(row);
});

const create = asyncHandler(async (req, res) => {
  let photo = req.file ? req.file.filename : null;
  const fromInquiry = Number(req.body.from_inquiry_id) || null;
  const forced = forcedReceptionist(req); // a receptionist is always recorded as themselves
  if (forced) req.body.receptionist_id = forced;
  if (fromInquiry) await assertOwned(req, "inquiries", fromInquiry);
  const conn = await db.getConnection();
  try {
    requireFields(req.body, REQUIRED);
    // Converting an inquiry: reuse its photo when no new one was uploaded.
    if (fromInquiry && !photo) {
      const [[inq]] = await conn.query("SELECT photo FROM inquiries WHERE id = ?", [fromInquiry]);
      photo = copyFile(inq?.photo);
    }
    await conn.beginTransaction();
    const admissionNo = await nextAdmissionNo(conn);
    const [r] = await conn.query("INSERT INTO admissions SET ?", [
      { ...fieldsFrom(req.body), admission_no: admissionNo, photo, status: "Pending", created_by: req.admin.id, inquiry_id: fromInquiry },
    ]);
    // The inquiry is now converted, so mark it Confirmed ("Contacted" in the DB).
    if (fromInquiry) {
      await conn.query("UPDATE inquiries SET status = 'Contacted' WHERE id = ?", [fromInquiry]);
    }
    await conn.commit();
    res.status(201).json({ id: r.insertId, admission_no: admissionNo });
  } catch (err) {
    await conn.rollback().catch(() => {});
    removeFile(photo);
    throw err;
  } finally {
    conn.release();
  }
});

const update = asyncHandler(async (req, res) => {
  const photo = req.file ? req.file.filename : null;
  const forced = forcedReceptionist(req);
  if (forced) req.body.receptionist_id = forced;
  try {
    const [[existing]] = await db.query("SELECT photo FROM admissions WHERE id = ?", [
      req.params.id,
    ]);
    if (!existing) throw httpError(404, "Admission not found");
    requireFields(req.body, REQUIRED);
    const values = fieldsFrom(req.body);
    if (photo) values.photo = photo;
    await db.query("UPDATE admissions SET ? WHERE id = ?", [values, req.params.id]);
    if (photo) removeFile(existing.photo);
    res.json({ id: Number(req.params.id) });
  } catch (err) {
    removeFile(photo);
    throw err;
  }
});

const remove = asyncHandler(async (req, res) => {
  const [[row]] = await db.query("SELECT photo FROM admissions WHERE id = ?", [
    req.params.id,
  ]);
  if (!row) throw httpError(404, "Admission not found");
  await db.query("DELETE FROM admissions WHERE id = ?", [req.params.id]);
  removeFile(row.photo);
  res.json({ success: true });
});

const updateStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!["Pending", "Confirmed"].includes(status)) {
    throw httpError(400, "Invalid status");
  }
  const [r] = await db.query("UPDATE admissions SET status = ? WHERE id = ?", [
    status,
    req.params.id,
  ]);
  if (!r.affectedRows) throw httpError(404, "Admission not found");
  res.json({ success: true });
});

module.exports = { list, stats, getOne, create, update, updateStatus, remove };
