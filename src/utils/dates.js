const pad = (n) => String(n).padStart(2, "0");

function toSqlDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "2026-11-10" -> "101126"
function toDdMmYy(sqlDate) {
  const [y, m, d] = String(sqlDate).slice(0, 10).split("-");
  return `${d}${m}${y.slice(2)}`;
}

module.exports = { toSqlDate, toDdMmYy, pad };
