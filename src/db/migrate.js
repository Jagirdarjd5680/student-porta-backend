// Small, idempotent column migrations for databases created before a column
// existed. Runs from `npm run db:init` and on every server start.
const MIGRATIONS = [
  ["inquiries", "photo", "VARCHAR(255) NULL AFTER student_name"],
  ["admissions", "identity_number", "VARCHAR(50) NULL AFTER identity_proof"],
  ["admissions", "special_offer_text", "VARCHAR(255) NULL AFTER special_offer"],
  ["admissions", "dob", "DATE NULL AFTER gender"],
  // Staff users: existing admins become super admins (default 1).
  ["admins", "phone", "VARCHAR(20) NULL AFTER email"],
  ["admins", "role_name", "VARCHAR(100) NULL AFTER phone"],
  ["admins", "permissions", "TEXT NULL AFTER role_name"],
  ["admins", "is_super", "TINYINT(1) NOT NULL DEFAULT 1 AFTER permissions"],
  ["admins", "photo", "VARCHAR(255) NULL AFTER phone"],
  // Who added each record (NULL = added before this existed; only "all" users see those).
  ["inquiries", "created_by", "INT NULL"],
  ["admissions", "created_by", "INT NULL"],
  ["students", "created_by", "INT NULL"],
  ["payments", "created_by", "INT NULL"],
  ["refunds", "created_by", "INT NULL"],
  // The inquiry an admission was converted from (so the student mail can attach both PDFs).
  ["admissions", "inquiry_id", "INT NULL"],
  // Category of a role user ("receptionist" | "other"). Receptionists feed the dropdowns.
  ["admins", "category", "VARCHAR(30) NULL AFTER role_name"],
  // "all" = sees everyone's records, "own" = only the records this user added.
  ["admins", "data_scope", "VARCHAR(10) NOT NULL DEFAULT 'all' AFTER category"],
  // A receptionists row linked to its role user (NULL = old record, no longer selectable).
  ["receptionists", "admin_id", "INT NULL"],
  // Student portal login: password + which portal menus the student may open.
  ["students", "password_hash", "VARCHAR(255) NULL"],
  ["students", "portal_menus", "TEXT NULL"],
  ["students", "token_version", "INT NOT NULL DEFAULT 0"],
];

const { syncReceptionist } = require("../utils/receptionists");

async function migrate(db, database) {
  await db.query(
    `CREATE TABLE IF NOT EXISTS settings (
       \`key\` VARCHAR(100) PRIMARY KEY,
       \`value\` TEXT NULL,
       updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
     )`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS certificates (
       id INT AUTO_INCREMENT PRIMARY KEY,
       student_id INT NOT NULL,
       title VARCHAR(200) NOT NULL,
       code VARCHAR(100) NOT NULL UNIQUE,
       file_path VARCHAR(255) NOT NULL,
       original_name VARCHAR(255) NULL,
       created_by INT NULL,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
     )`,
  );
  for (const [table, column, definition] of MIGRATIONS) {
    const [cols] = await db.query(
      "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?",
      [database, table, column],
    );
    if (cols.length === 0) {
      await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
      console.log(`Migration: added column ${table}.${column}`);
    }
  }

  // Certificates: new portal menu for students that already had every other menu ticked.
  const oldMenus = ["course", "materials", "profile", "payments"];
  const [withMenus] = await db.query("SELECT id, portal_menus FROM students WHERE portal_menus IS NOT NULL");
  for (const st of withMenus) {
    try {
      const list = JSON.parse(st.portal_menus);
      if (Array.isArray(list) && oldMenus.every((m) => list.includes(m)) && !list.includes("certificates")) {
        await db.query("UPDATE students SET portal_menus = ? WHERE id = ?", [JSON.stringify([...list, "certificates"]), st.id]);
      }
    } catch {
      /* ignore bad JSON */
    }
  }

  // One-time backfill: role users whose role name says "receptionist" become Receptionists.
  const [legacy] = await db.query(
    "SELECT id, name FROM admins WHERE category IS NULL AND is_super = 0 AND role_name LIKE '%receptionist%'",
  );
  for (const u of legacy) {
    await db.query("UPDATE admins SET category = 'receptionist' WHERE id = ?", [u.id]);
    await syncReceptionist(db, u.id, u.name, true);
    console.log(`Migration: ${u.name} marked as Receptionist`);
  }
}

module.exports = { migrate };
