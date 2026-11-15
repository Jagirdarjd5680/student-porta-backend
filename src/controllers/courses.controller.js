const db = require("../config/db");
const {
  asyncHandler,
  httpError,
  requireFields,
  emptyToNull,
  toNumber,
} = require("../utils/http");

const list = asyncHandler(async (req, res) => {
  const search = (req.query.search || "").trim();
  const params = [];
  let where = "";
  if (search) {
    where = "WHERE c.name LIKE ? OR cat.name LIKE ?";
    params.push(`%${search}%`, `%${search}%`);
  }
  const [rows] = await db.query(
    `SELECT c.*, cat.name AS category_name, d.name AS duration_name
     FROM courses c
     LEFT JOIN categories cat ON cat.id = c.category_id
     LEFT JOIN durations d ON d.id = c.duration_id
     ${where}
     ORDER BY c.name`,
    params,
  );
  res.json(rows);
});

const save = asyncHandler(async (req, res) => {
  requireFields(req.body, [
    ["name", "Course Name"],
    ["fee", "Fee"],
  ]);
  const b = req.body;
  const values = [
    b.name.trim(),
    emptyToNull(b.category_id),
    toNumber(b.fee),
    emptyToNull(b.duration_id),
    emptyToNull(b.description),
  ];

  if (req.params.id) {
    const [r] = await db.query(
      `UPDATE courses SET name = ?, category_id = ?, fee = ?, duration_id = ?, description = ?
       WHERE id = ?`,
      [...values, req.params.id],
    );
    if (!r.affectedRows) throw httpError(404, "Course not found");
    return res.json({ id: Number(req.params.id) });
  }

  const [r] = await db.query(
    `INSERT INTO courses (name, category_id, fee, duration_id, description)
     VALUES (?, ?, ?, ?, ?)`,
    values,
  );
  res.status(201).json({ id: r.insertId });
});

const remove = asyncHandler(async (req, res) => {
  await db.query("DELETE FROM courses WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

module.exports = { list, save, remove };
