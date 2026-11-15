// "Own data only" roles: a user whose data_scope is "own" sees and changes only the
// records they added (created_by). Super admins and "all" users see everything.
const db = require("../config/db");
const { httpError } = require("./http");

const isOwn = (req) => Boolean(req.admin) && !req.admin.is_super && req.admin.data_scope === "own";

/** `{ sql, params }` for a WHERE clause, or null when the user sees everything. alias "" = no alias. */
function ownClause(req, alias) {
  if (!isOwn(req)) return null;
  return { sql: `${alias ? `${alias}.` : ""}created_by = ?`, params: [req.admin.id] };
}

/** Push the own-data condition onto a `where` / `params` pair. */
function addOwn(req, alias, where, params) {
  const c = ownClause(req, alias);
  if (c) {
    where.push(c.sql);
    params.push(...c.params);
  }
}

/** 404 when an "own data" user touches a record somebody else added. */
async function assertOwned(req, table, id) {
  if (!isOwn(req)) return;
  const [[row]] = await db.query(`SELECT created_by FROM \`${table}\` WHERE id = ?`, [id]);
  if (!row || row.created_by !== req.admin.id) throw httpError(404, "Not found");
}

/** Route middleware: guards `/:id` routes of one table. */
const scoped = (table) => (req, res, next) => assertOwned(req, table, req.params.id).then(() => next(), next);

/**
 * A receptionist adding or editing a record is always recorded as the receptionist:
 * returns their receptionist id (null for everyone else, e.g. admins).
 */
function forcedReceptionist(req) {
  const a = req.admin;
  if (!a || a.is_super || a.category !== "receptionist") return null;
  if (!a.receptionist_id) {
    throw httpError(400, "Your receptionist profile is not linked yet. Please ask the admin to save your role again.");
  }
  return a.receptionist_id;
}

module.exports = { isOwn, ownClause, addOwn, assertOwned, scoped, forcedReceptionist };
