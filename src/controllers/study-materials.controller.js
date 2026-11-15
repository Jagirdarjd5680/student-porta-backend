const db = require("../config/db");
const { removeFile } = require("../middleware/upload");
const {
  asyncHandler,
  httpError,
  requireFields,
  emptyToNull,
} = require("../utils/http");

const TYPES = ["PDF Document", "Image", "Text Content"];

const list = asyncHandler(async (req, res) => {
  const { course_id, duration_id } = req.query;
  if (!course_id || !duration_id) {
    throw httpError(400, "Course and Duration are required");
  }
  const [rows] = await db.query(
    `SELECT * FROM study_materials WHERE course_id = ? AND duration_id = ?
     ORDER BY topic, id DESC`,
    [course_id, duration_id],
  );
  res.json(rows);
});

const topics = asyncHandler(async (req, res) => {
  const { course_id, duration_id } = req.query;
  const [rows] = await db.query(
    `SELECT DISTINCT topic FROM study_materials
     WHERE course_id = ? AND duration_id = ? ORDER BY topic`,
    [course_id, duration_id],
  );
  res.json(rows.map((r) => r.topic));
});

function readBody(body) {
  requireFields(body, [
    ["course_id", "Course"],
    ["duration_id", "Duration"],
    ["topic", "Topic"],
    ["material_type", "Material Type"],
    ["title", "Title"],
  ]);
  if (!TYPES.includes(body.material_type)) {
    throw httpError(400, "Invalid material type");
  }
  return {
    course_id: body.course_id,
    duration_id: body.duration_id,
    topic: body.topic.trim(),
    material_type: body.material_type,
    title: body.title.trim(),
    content: emptyToNull(body.content),
  };
}

const create = asyncHandler(async (req, res) => {
  const file = req.file ? req.file.filename : null;
  try {
    const values = { ...readBody(req.body), file_path: file };
    const [r] = await db.query("INSERT INTO study_materials SET ?", [values]);
    res.status(201).json({ id: r.insertId });
  } catch (err) {
    removeFile(file);
    throw err;
  }
});

const update = asyncHandler(async (req, res) => {
  const file = req.file ? req.file.filename : null;
  try {
    const [[existing]] = await db.query(
      "SELECT file_path FROM study_materials WHERE id = ?",
      [req.params.id],
    );
    if (!existing) throw httpError(404, "Study material not found");

    const values = readBody(req.body);
    const removeOld = file || req.body.remove_file === "true";
    if (removeOld) values.file_path = file;
    await db.query("UPDATE study_materials SET ? WHERE id = ?", [
      values,
      req.params.id,
    ]);
    if (removeOld) removeFile(existing.file_path);
    res.json({ id: Number(req.params.id) });
  } catch (err) {
    removeFile(file);
    throw err;
  }
});

const remove = asyncHandler(async (req, res) => {
  const [[existing]] = await db.query(
    "SELECT file_path FROM study_materials WHERE id = ?",
    [req.params.id],
  );
  if (!existing) throw httpError(404, "Study material not found");
  await db.query("DELETE FROM study_materials WHERE id = ?", [req.params.id]);
  removeFile(existing.file_path);
  res.json({ success: true });
});

module.exports = { list, topics, create, update, remove };
