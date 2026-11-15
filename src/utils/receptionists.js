/**
 * Keep the `receptionists` table (used by inquiry / admission records) in step with
 * the role user: a Receptionist gets a linked row; anyone else is unlinked. Rows are
 * never deleted, so old inquiries / admissions keep showing the receptionist's name.
 */
async function syncReceptionist(db, adminId, name, isReceptionist) {
  const [[linked]] = await db.query("SELECT id FROM receptionists WHERE admin_id = ?", [adminId]);
  if (!isReceptionist) {
    if (linked) await db.query("UPDATE receptionists SET admin_id = NULL WHERE id = ?", [linked.id]);
    return;
  }
  const [[same]] = await db.query("SELECT id, admin_id FROM receptionists WHERE name = ? AND id <> ?", [
    name,
    linked ? linked.id : 0,
  ]);
  // The name column is unique: another row with this name -> adopt it if free, else add a suffix.
  if (!linked && same && !same.admin_id) {
    await db.query("UPDATE receptionists SET admin_id = ? WHERE id = ?", [adminId, same.id]);
    return;
  }
  const finalName = same ? `${name} (${adminId})` : name;
  if (linked) await db.query("UPDATE receptionists SET name = ? WHERE id = ?", [finalName, linked.id]);
  else await db.query("INSERT INTO receptionists (name, admin_id) VALUES (?, ?)", [finalName, adminId]);
}

module.exports = { syncReceptionist };
