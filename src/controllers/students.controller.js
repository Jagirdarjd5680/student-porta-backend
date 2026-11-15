const db = require("../config/db");
const { addOwn, assertOwned } = require("../utils/scope");
const { makeStudentCode } = require("../utils/codes");
const { STUDENT_SELECT, calcFee } = require("../utils/student-sql");
const bcrypt = require("bcryptjs");
const { removeFile, copyFile } = require("../middleware/upload");
const { sanitizeMenus, MENUS } = require("../utils/student-menus");
const {
  asyncHandler,
  httpError,
  requireFields,
  emptyToNull,
  cleanPhone,
} = require("../utils/http");

const list = asyncHandler(async (req, res) => {
  const { search, course_id, duration_id } = req.query;
  const where = [];
  const params = [];
  if (search) {
    where.push(
      "(s.student_code LIKE ? OR CONCAT_WS(' ', s.first_name, s.last_name) LIKE ? OR s.email LIKE ? OR s.phone LIKE ?)",
    );
    params.push(...Array(4).fill(`%${search}%`));
  }
  if (course_id) where.push("s.course_id = ?") && params.push(course_id);
  if (duration_id) where.push("s.duration_id = ?") && params.push(duration_id);
  addOwn(req, "s", where, params);

  const [rows] = await db.query(
    `${STUDENT_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY s.id DESC`,
    params,
  );
  res.json(rows);
});

const getOne = asyncHandler(async (req, res) => {
  const [[student]] = await db.query(`${STUDENT_SELECT} WHERE s.id = ?`, [
    req.params.id,
  ]);
  if (!student) throw httpError(404, "Student not found");
  const [payments] = await db.query(
    "SELECT * FROM payments WHERE student_id = ? ORDER BY payment_date DESC, id DESC",
    [req.params.id],
  );
  res.json({ ...student, payments });
});

async function buildValues(body) {
  requireFields(body, [
    ["first_name", "First Name"],
    ["course_id", "Course"],
  ]);
  const [[course]] = await db.query("SELECT fee FROM courses WHERE id = ?", [
    body.course_id,
  ]);
  if (!course) throw httpError(400, "Selected course not found");

  const discountType = body.discount_type === "percentage" ? "percentage" : "fixed";
  const { discountAmount, totalFee } = calcFee(
    course.fee,
    discountType,
    body.discount_value,
  );
  return {
    first_name: body.first_name.trim(),
    last_name: emptyToNull(body.last_name),
    email: emptyToNull(body.email),
    phone: cleanPhone(body.phone),
    dob: emptyToNull(body.dob),
    admission_date: emptyToNull(body.admission_date),
    address: emptyToNull(body.address),
    course_id: body.course_id,
    duration_id: emptyToNull(body.duration_id),
    course_fee: course.fee,
    discount_type: discountType,
    discount_value: Number(body.discount_value) || 0,
    discount_amount: discountAmount,
    total_fee: totalFee,
  };
}

// Password rules shared by create (required) and update (optional).
function readPassword(body, { required }) {
  const pw = String(body.password || "");
  if (!pw) {
    if (required) throw httpError(400, "Password is required");
    return null;
  }
  if (pw.length < 8) throw httpError(400, "Password must be at least 8 characters");
  if (pw !== String(body.confirm_password || "")) {
    throw httpError(400, "Password and Re-enter Password do not match");
  }
  return pw;
}

const create = asyncHandler(async (req, res) => {
  let photo = req.file ? req.file.filename : null;
  const fromAdmission = Number(req.body.from_admission_id) || null;
  try {
    if (fromAdmission) await assertOwned(req, "admissions", fromAdmission);
    const values = await buildValues(req.body);
    // Converting an admission: reuse its photo when no new one was uploaded.
    if (fromAdmission && !photo) {
      const [[adm]] = await db.query("SELECT photo FROM admissions WHERE id = ?", [fromAdmission]);
      photo = copyFile(adm?.photo);
    }
    const password = readPassword(req.body, { required: true });
    values.password_hash = await bcrypt.hash(password, 10);
    values.portal_menus = sanitizeMenus(req.body.portal_menus ?? MENUS);
    values.student_code = makeStudentCode(values.first_name, values.last_name);
    values.photo = photo;
    values.created_by = req.admin.id;
    const [r] = await db.query("INSERT INTO students SET ?", [values]);
    // The admission is now a student, so mark it Confirmed.
    if (fromAdmission) {
      await db.query("UPDATE admissions SET status = 'Confirmed' WHERE id = ?", [fromAdmission]);
    }
    res.status(201).json({ id: r.insertId, student_code: values.student_code });
  } catch (err) {
    removeFile(photo);
    throw err;
  }
});

const update = asyncHandler(async (req, res) => {
  const photo = req.file ? req.file.filename : null;
  try {
    const [[existing]] = await db.query(
      `${STUDENT_SELECT} WHERE s.id = ?`,
      [req.params.id],
    );
    if (!existing) throw httpError(404, "Student not found");
    const [[{ token_version }]] = await db.query("SELECT token_version FROM students WHERE id = ?", [req.params.id]);
    existing.token_version = token_version;

    const values = await buildValues(req.body);
    if (values.total_fee < Number(existing.total_paid)) {
      throw httpError(400, "Total fee cannot be less than amount already paid");
    }
    if (photo) values.photo = photo;
    if (req.body.portal_menus !== undefined) values.portal_menus = sanitizeMenus(req.body.portal_menus);
    const password = readPassword(req.body, { required: false });
    if (password) {
      values.password_hash = await bcrypt.hash(password, 10);
      // Changing the password signs the student out everywhere.
      values.token_version = (existing.token_version ?? 0) + 1;
    }
    await db.query("UPDATE students SET ? WHERE id = ?", [values, req.params.id]);
    if (photo) removeFile(existing.photo);
    res.json({ id: Number(req.params.id) });
  } catch (err) {
    removeFile(photo);
    throw err;
  }
});

const remove = asyncHandler(async (req, res) => {
  const [[student]] = await db.query("SELECT photo FROM students WHERE id = ?", [
    req.params.id,
  ]);
  if (!student) throw httpError(404, "Student not found");
  await db.query("DELETE FROM students WHERE id = ?", [req.params.id]);
  removeFile(student.photo);
  res.json({ success: true });
});

module.exports = { list, getOne, create, update, remove };
