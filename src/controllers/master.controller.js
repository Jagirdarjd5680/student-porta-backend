// Categories, Durations and Receptionists (simple master data).
const db = require("../config/db");
const {
  asyncHandler,
  httpError,
  requireFields,
  emptyToNull,
  toNumber,
} = require("../utils/http");

/* ---------- Categories ---------- */
const listCategories = asyncHandler(async (_req, res) => {
  const [rows] = await db.query(
    `SELECT c.*, (SELECT COUNT(*) FROM courses WHERE category_id = c.id) AS course_count
     FROM categories c ORDER BY c.name`,
  );
  res.json(rows);
});

const saveCategory = asyncHandler(async (req, res) => {
  requireFields(req.body, [["name", "Name"]]);
  const values = [req.body.name.trim(), emptyToNull(req.body.description)];
  if (req.params.id) {
    const [r] = await db.query(
      "UPDATE categories SET name = ?, description = ? WHERE id = ?",
      [...values, req.params.id],
    );
    if (!r.affectedRows) throw httpError(404, "Category not found");
    return res.json({ id: Number(req.params.id) });
  }
  const [r] = await db.query(
    "INSERT INTO categories (name, description) VALUES (?, ?)",
    values,
  );
  res.status(201).json({ id: r.insertId });
});

const deleteCategory = asyncHandler(async (req, res) => {
  await db.query("DELETE FROM categories WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

/* ---------- Durations ---------- */
const listDurations = asyncHandler(async (_req, res) => {
  const [rows] = await db.query("SELECT * FROM durations ORDER BY days, name");
  res.json(rows);
});

const saveDuration = asyncHandler(async (req, res) => {
  requireFields(req.body, [
    ["name", "Name"],
    ["days", "Days"],
  ]);
  const values = [
    req.body.name.trim(),
    toNumber(req.body.days),
    emptyToNull(req.body.description),
  ];
  if (req.params.id) {
    const [r] = await db.query(
      "UPDATE durations SET name = ?, days = ?, description = ? WHERE id = ?",
      [...values, req.params.id],
    );
    if (!r.affectedRows) throw httpError(404, "Duration not found");
    return res.json({ id: Number(req.params.id) });
  }
  const [r] = await db.query(
    "INSERT INTO durations (name, days, description) VALUES (?, ?, ?)",
    values,
  );
  res.status(201).json({ id: r.insertId });
});

const deleteDuration = asyncHandler(async (req, res) => {
  await db.query("DELETE FROM durations WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

/* ---------- Receptionists (dropdown only) ---------- */
// Dropdown = role users with category "Receptionist". `?all=1` also returns old records
// (for filters and for showing the name saved on an old inquiry / admission).
const listReceptionists = asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    `SELECT id, name, admin_id IS NOT NULL AS active FROM receptionists
     ${req.query.all ? "" : "WHERE admin_id IS NOT NULL"} ORDER BY name`,
  );
  res.json(rows);
});

module.exports = {
  listCategories,
  saveCategory,
  deleteCategory,
  listDurations,
  saveDuration,
  deleteDuration,
  listReceptionists,
};
