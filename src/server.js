const app = require("./app");
const env = require("./config/env");
const db = require("./config/db");
const { migrate } = require("./db/migrate");

async function start() {
  try {
    await db.query("SELECT 1");
    await migrate(db, env.db.database);
  } catch (err) {
    console.error("Cannot connect to MySQL:", err.message);
    console.error("Check DB_* values in backend/.env and run `npm run db:init`.");
    process.exit(1);
  }
  app.listen(env.port, () => {
    console.log(`API running on http://localhost:${env.port}/api`);
  });
}

start();
