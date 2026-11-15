const mysql = require("mysql2/promise");
const env = require("./env");

const pool = mysql.createPool({
  ...env.db,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
  decimalNumbers: true,
  multipleStatements: false,
});

// SQL-injection guard. Values are always bound as parameters, but mysql2's `query()`
// turns arrays / nested objects into SQL fragments (e.g. `?course_id[x]=1` or a JSON body
// `{"phone": {"a": 1}}`). So only plain scalars may reach the database:
//  - a parameter must be a string / number / boolean / null / Date / Buffer;
//  - a plain object is allowed only as the `SET ?` row, and then every value must be scalar.
const isScalar = (v) =>
  v === null ||
  v === undefined ||
  ["string", "number", "boolean", "bigint"].includes(typeof v) ||
  v instanceof Date ||
  Buffer.isBuffer(v);

function assertSafeParams(params) {
  if (params === undefined) return;
  const list = Array.isArray(params) ? params : [params];
  for (const p of list) {
    if (isScalar(p)) continue;
    const plain = Object.getPrototypeOf(p) === Object.prototype;
    if (plain && Object.values(p).every(isScalar)) continue;
    const err = new Error("Invalid input");
    err.status = 400;
    throw err;
  }
}

function guard(target) {
  const query = target.query.bind(target);
  target.query = (sql, params) => {
    try {
      assertSafeParams(params);
    } catch (err) {
      return Promise.reject(err);
    }
    return query(sql, params);
  };
  return target;
}

guard(pool);
const getConnection = pool.getConnection.bind(pool);
pool.getConnection = async () => guard(await getConnection());

module.exports = pool;
