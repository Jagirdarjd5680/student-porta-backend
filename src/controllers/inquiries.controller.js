const db = require("../config/db");
const env = require("../config/env");
const { addOwn, ownClause, forcedReceptionist } = require("../utils/scope");
const { removeFile } = require("../middleware/upload");
const { nextInquiryNo } = require("../utils/codes");
const { toSqlDate } = require("../utils/dates");
const {
  asyncHandler,
  httpError,
  requireFields,
  emptyToNull,
  cleanPhone,
} = require("../utils/http");

const INQUIRY_SELECT = `SELECT i.*, c.name AS course_name, r.name AS receptionist_name
     FROM inquiries i
     LEFT JOIN courses c ON c.id = i.course_id
     LEFT JOIN receptionists r ON r.id = i.receptionist_id`;

const REQUIRED = [
  ["student_name", "Student Name"],
  ["phone", "Phone Number"],
  ["receptionist_id", "Receptionist"],
  ["course_id", "Course"],
];

// Editable columns from a request body (create + update share this).
const fieldsFrom = (b) => ({
  student_name: b.student_name.trim(),
  email: emptyToNull(b.email),
  phone: cleanPhone(b.phone),
  gender: emptyToNull(b.gender),
  address: emptyToNull(b.address),
  state: emptyToNull(b.state),
  city: emptyToNull(b.city),
  zip_code: emptyToNull(b.zip_code),
  receptionist_id: b.receptionist_id,
  course_id: b.course_id,
  source: emptyToNull(b.source),
  inquiry_date: emptyToNull(b.inquiry_date) || toSqlDate(),
});

const list = asyncHandler(async (req, res) => {
  const { search, status, from, to, course_id, source, state, receptionist_id } =
    req.query;
  const where = [];
  const params = [];

  if (search) {
    where.push(
      "(i.inquiry_no LIKE ? OR i.student_name LIKE ? OR i.phone LIKE ? OR i.email LIKE ?)",
    );
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) where.push("i.status = ?") && params.push(status);
  if (from) where.push("i.inquiry_date >= ?") && params.push(from);
  if (to) where.push("i.inquiry_date <= ?") && params.push(to);
  if (course_id) where.push("i.course_id = ?") && params.push(course_id);
  if (source) where.push("i.source = ?") && params.push(source);
  if (state) where.push("i.state = ?") && params.push(state);
  if (receptionist_id) where.push("i.receptionist_id = ?") && params.push(receptionist_id);
  addOwn(req, "i", where, params);

  const [rows] = await db.query(
    `${INQUIRY_SELECT}
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY i.id DESC`,
    params,
  );
  res.json(rows);
});

const stats = asyncHandler(async (req, res) => {
  const ow = ownClause(req, "") || { sql: "", params: [] };
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS total,
       SUM(status = 'Pending') AS pending,
       SUM(status = 'Contacted') AS contacted,
       SUM(inquiry_date = CURDATE()) AS today,
       SUM(YEARWEEK(inquiry_date, 1) = YEARWEEK(CURDATE(), 1)) AS this_week
     FROM inquiries ${ow.sql ? `WHERE ${ow.sql}` : ""}`,
    ow.params,
  );
  res.json({
    total: Number(row.total) || 0,
    pending: Number(row.pending) || 0,
    contacted: Number(row.contacted) || 0,
    today: Number(row.today) || 0,
    thisWeek: Number(row.this_week) || 0,
  });
});

const getOne = asyncHandler(async (req, res) => {
  const [[row]] = await db.query(`${INQUIRY_SELECT} WHERE i.id = ?`, [req.params.id]);
  if (!row) throw httpError(404, "Inquiry not found");
  res.json(row);
});

const create = asyncHandler(async (req, res) => {
  const photo = req.file ? req.file.filename : null;
  const forced = forcedReceptionist(req); // a receptionist is always recorded as themselves
  if (forced) req.body.receptionist_id = forced;
  const conn = await db.getConnection();
  try {
    requireFields(req.body, REQUIRED);
    await conn.beginTransaction();
    const inquiryNo = await nextInquiryNo(conn);
    const [r] = await conn.query("INSERT INTO inquiries SET ?", [
      { ...fieldsFrom(req.body), inquiry_no: inquiryNo, photo, status: "Pending", created_by: req.admin.id },
    ]);
    await conn.commit();
    res.status(201).json({ id: r.insertId, inquiry_no: inquiryNo });
  } catch (err) {
    await conn.rollback();
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
    const [[existing]] = await db.query("SELECT photo FROM inquiries WHERE id = ?", [
      req.params.id,
    ]);
    if (!existing) throw httpError(404, "Inquiry not found");
    requireFields(req.body, REQUIRED);
    const values = fieldsFrom(req.body);
    if (photo) values.photo = photo;
    await db.query("UPDATE inquiries SET ? WHERE id = ?", [values, req.params.id]);
    if (photo) removeFile(existing.photo);
    res.json({ id: Number(req.params.id) });
  } catch (err) {
    removeFile(photo);
    throw err;
  }
});

const updateStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!["Pending", "Contacted"].includes(status)) {
    throw httpError(400, "Invalid status");
  }
  const [r] = await db.query("UPDATE inquiries SET status = ? WHERE id = ?", [
    status,
    req.params.id,
  ]);
  if (!r.affectedRows) throw httpError(404, "Inquiry not found");
  res.json({ success: true });
});

const remove = asyncHandler(async (req, res) => {
  const [[row]] = await db.query("SELECT photo FROM inquiries WHERE id = ?", [
    req.params.id,
  ]);
  if (!row) throw httpError(404, "Inquiry not found");
  await db.query("DELETE FROM inquiries WHERE id = ?", [req.params.id]);
  removeFile(row.photo);
  res.json({ success: true });
});

// Institute details for printed forms (saved in Settings, .env as fallback).
const institute = asyncHandler(async (_req, res) => {
  res.json(await require("../services/settings").getInstitute());
});

module.exports = { list, stats, getOne, create, update, updateStatus, remove, institute };
