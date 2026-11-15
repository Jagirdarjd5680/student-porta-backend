const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const env = require("../config/env");
const { migrate } = require("./migrate");

async function init() {
  const { database, ...conn } = env.db;
  const db = await mysql.createConnection({
    ...conn,
    multipleStatements: true,
  });

  await db.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await db.changeUser({ database });

  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await db.query(schema);

  await migrate(db, database);

  const [admins] = await db.query("SELECT id FROM admins WHERE email = ?", [
    env.admin.email,
  ]);
  if (admins.length === 0) {
    const hash = await bcrypt.hash(env.admin.password, 10);
    await db.query(
      "INSERT INTO admins (name, email, password_hash) VALUES (?, ?, ?)",
      [env.admin.name, env.admin.email, hash],
    );
    console.log(`Admin created: ${env.admin.email}`);
  }

  await db.end();
  console.log(`Database "${database}" is ready.`);
}

init().catch((err) => {
  console.error("DB init failed:", err.message);
  process.exit(1);
});
