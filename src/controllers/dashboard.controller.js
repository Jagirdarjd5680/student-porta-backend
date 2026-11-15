const db = require("../config/db");
const { toSqlDate } = require("../utils/dates");
const { asyncHandler } = require("../utils/http");
const { can } = require("../utils/permissions");
const { isOwn } = require("../utils/scope");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const summary = asyncHandler(async (_req, res) => {
  const [[row]] = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM students) AS total_students,
       (SELECT COUNT(*) FROM courses) AS total_courses,
       (SELECT COUNT(*) FROM categories) AS total_categories,
       (SELECT COALESCE(SUM(amount), 0) FROM payments
          WHERE YEAR(payment_date) = YEAR(CURDATE()) AND MONTH(payment_date) = MONTH(CURDATE())) AS month_amount,
       (SELECT COUNT(*) FROM payments
          WHERE YEAR(payment_date) = YEAR(CURDATE()) AND MONTH(payment_date) = MONTH(CURDATE())) AS month_count`,
  );
  res.json({
    totalStudents: Number(row.total_students),
    totalCourses: Number(row.total_courses),
    totalCategories: Number(row.total_categories),
    monthPayments: {
      amount: Number(row.month_amount),
      count: Number(row.month_count),
    },
  });
});

// Builds buckets for the chosen period: day | week | month | year
function buildBuckets(period, today) {
  const buckets = [];
  if (period === "day") {
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const start = toSqlDate(d);
      buckets.push({ label: `${d.getDate()} ${MONTHS[d.getMonth()]}`, start, end: start });
    }
  } else if (period === "week") {
    const monday = new Date(today);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    for (let i = 11; i >= 0; i--) {
      const s = new Date(monday);
      s.setDate(s.getDate() - i * 7);
      const e = new Date(s);
      e.setDate(e.getDate() + 6);
      buckets.push({
        label: `${s.getDate()} ${MONTHS[s.getMonth()]}`,
        start: toSqlDate(s),
        end: toSqlDate(e),
      });
    }
  } else if (period === "year") {
    for (let i = 4; i >= 0; i--) {
      const y = today.getFullYear() - i;
      buckets.push({ label: String(y), start: `${y}-01-01`, end: `${y}-12-31` });
    }
  } else {
    const y = today.getFullYear();
    for (let m = 0; m < 12; m++) {
      const last = new Date(y, m + 1, 0);
      buckets.push({
        label: MONTHS[m],
        start: toSqlDate(new Date(y, m, 1)),
        end: toSqlDate(last),
      });
    }
  }
  return buckets;
}

const income = asyncHandler(async (req, res) => {
  const period = ["day", "week", "month", "year"].includes(req.query.period)
    ? req.query.period
    : "month";
  const buckets = buildBuckets(period, new Date());
  const from = buckets[0].start;
  const to = buckets[buckets.length - 1].end;

  const [rows] = await db.query(
    `SELECT payment_date AS date, SUM(amount) AS total FROM payments
     WHERE payment_date BETWEEN ? AND ? GROUP BY payment_date`,
    [from, to],
  );

  const values = buckets.map((b) =>
    rows
      .filter((r) => r.date >= b.start && r.date <= b.end)
      .reduce((sum, r) => sum + Number(r.total), 0),
  );

  res.json({
    period,
    labels: buckets.map((b) => b.label),
    values,
    total: values.reduce((a, b) => a + b, 0),
  });
});

const recentPayments = asyncHandler(async (_req, res) => {
  const [rows] = await db.query(
    `SELECT p.id, p.invoice_no, p.amount, p.payment_date, p.method,
       CONCAT_WS(' ', s.first_name, s.last_name) AS student_name, s.student_code
     FROM payments p JOIN students s ON s.id = p.student_id
     ORDER BY p.payment_date DESC, p.id DESC LIMIT 5`,
  );
  res.json(rows);
});

// ---------------------------------------------------------------------------
// Overview: one call for the dashboard, filtered by date range + course.
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;
const parseDate = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

// Day buckets for ranges up to 62 days, month buckets otherwise.
function rangeBuckets(from, to) {
  const start = parseDate(from);
  const end = parseDate(to);
  const days = Math.round((end - start) / DAY_MS) + 1;
  const buckets = [];
  if (days <= 62) {
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const k = toSqlDate(d);
      buckets.push({ label: `${d.getDate()} ${MONTHS[d.getMonth()]}`, start: k, end: k });
    }
    return { unit: "day", buckets };
  }
  let y = start.getFullYear();
  let m = start.getMonth();
  while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth())) {
    const s = new Date(y, m, 1);
    const e = new Date(y, m + 1, 0);
    buckets.push({
      label: `${MONTHS[m]} ${String(y).slice(2)}`,
      start: toSqlDate(s < start ? start : s),
      end: toSqlDate(e > end ? end : e),
    });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return { unit: "month", buckets };
}

const sumInto = (buckets, rows, field = "n") =>
  buckets.map((b) =>
    rows
      .filter((r) => r.date >= b.start && r.date <= b.end)
      .reduce((sum, r) => sum + Number(r[field]), 0),
  );

const overview = asyncHandler(async (req, res) => {
  const today = toSqlDate(new Date());
  const to = DATE_RE.test(req.query.to || "") ? req.query.to : today;
  const defaultFrom = toSqlDate(new Date(parseDate(to).getFullYear(), parseDate(to).getMonth() - 5, 1));
  let from = DATE_RE.test(req.query.from || "") ? req.query.from : defaultFrom;
  if (from > to) from = to;
  const courseId = req.query.course_id ? Number(req.query.course_id) || null : null;

  // Previous period of the same length, for the "vs previous" badges.
  const lengthDays = Math.round((parseDate(to) - parseDate(from)) / DAY_MS) + 1;
  const prevTo = new Date(parseDate(from).getTime() - DAY_MS);
  const prevFrom = new Date(prevTo.getTime() - (lengthDays - 1) * DAY_MS);
  const pFrom = toSqlDate(prevFrom);
  const pTo = toSqlDate(prevTo);

  const course = (col) => (courseId ? ` AND ${col} = ${db.escape(courseId)}` : "");
  const studentDate = "COALESCE(s.admission_date, DATE(s.created_at))";
  // "Own data only" users see numbers from the records they added.
  const own = (alias) => (isOwn(req) ? ` AND ${alias}.created_by = ${db.escape(req.admin.id)}` : "");

  const totalsSql = (a, b) => `SELECT
      (SELECT COUNT(*) FROM students s WHERE ${studentDate} BETWEEN ${a} AND ${b}${course("s.course_id")}${own("s")}) AS students,
      (SELECT COUNT(*) FROM inquiries i WHERE i.inquiry_date BETWEEN ${a} AND ${b}${course("i.course_id")}${own("i")}) AS inquiries,
      (SELECT COUNT(*) FROM admissions ad WHERE ad.admission_date BETWEEN ${a} AND ${b}${course("ad.course_id")}${own("ad")}) AS admissions,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p JOIN students s ON s.id = p.student_id
         WHERE p.payment_date BETWEEN ${a} AND ${b}${course("s.course_id")}${own("p")}) AS revenue`;

  const [[cur]] = await db.query(totalsSql("?", "?"), [from, to, from, to, from, to, from, to]);
  const [[prev]] = await db.query(totalsSql("?", "?"), [pFrom, pTo, pFrom, pTo, pFrom, pTo, pFrom, pTo]);

  const { unit, buckets } = rangeBuckets(from, to);

  const [revRows] = await db.query(
    `SELECT p.payment_date AS date, SUM(p.amount) AS n FROM payments p JOIN students s ON s.id = p.student_id
     WHERE p.payment_date BETWEEN ? AND ?${course("s.course_id")}${own("p")} GROUP BY p.payment_date`,
    [from, to],
  );
  const [inqRows] = await db.query(
    `SELECT i.inquiry_date AS date, COUNT(*) AS n,
       SUM(i.status = 'Pending') AS pending, SUM(i.status = 'Contacted') AS confirmed
     FROM inquiries i WHERE i.inquiry_date BETWEEN ? AND ?${course("i.course_id")}${own("i")} GROUP BY i.inquiry_date`,
    [from, to],
  );
  const [admRows] = await db.query(
    `SELECT ad.admission_date AS date, COUNT(*) AS n FROM admissions ad
     WHERE ad.admission_date BETWEEN ? AND ?${course("ad.course_id")}${own("ad")} GROUP BY ad.admission_date`,
    [from, to],
  );
  const [methodRows] = await db.query(
    `SELECT p.method AS label, SUM(p.amount) AS amount, COUNT(*) AS count
     FROM payments p JOIN students s ON s.id = p.student_id
     WHERE p.payment_date BETWEEN ? AND ?${course("s.course_id")}${own("p")}
     GROUP BY p.method ORDER BY amount DESC`,
    [from, to],
  );
  const [courseRows] = await db.query(
    `SELECT COALESCE(c.name, 'Not set') AS label, COUNT(*) AS count
     FROM admissions ad LEFT JOIN courses c ON c.id = ad.course_id
     WHERE ad.admission_date BETWEEN ? AND ?${course("ad.course_id")}${own("ad")}
     GROUP BY label ORDER BY count DESC LIMIT 6`,
    [from, to],
  );

  // Latest activity across modules (course filter applies, date range does not).
  const [recent] = await db.query(
    `(SELECT 'inquiry' AS type, i.id, i.student_name AS name, c.name AS detail, NULL AS amount,
        i.inquiry_date AS date, i.created_at AS at
      FROM inquiries i LEFT JOIN courses c ON c.id = i.course_id WHERE 1=1${course("i.course_id")}${own("i")}
      ORDER BY i.created_at DESC LIMIT 8)
     UNION ALL
     (SELECT 'admission', ad.id, ad.student_name, c.name, ad.form_fees, ad.admission_date, ad.created_at
      FROM admissions ad LEFT JOIN courses c ON c.id = ad.course_id WHERE 1=1${course("ad.course_id")}${own("ad")}
      ORDER BY ad.created_at DESC LIMIT 8)
     UNION ALL
     (SELECT 'payment', p.id, CONCAT_WS(' ', s.first_name, s.last_name), p.method, p.amount, p.payment_date, p.created_at
      FROM payments p JOIN students s ON s.id = p.student_id WHERE 1=1${course("s.course_id")}${own("p")}
      ORDER BY p.created_at DESC LIMIT 8)
     ORDER BY at DESC LIMIT 8`,
  );

  const totals = (r) => ({
    students: Number(r.students),
    inquiries: Number(r.inquiries),
    admissions: Number(r.admissions),
    revenue: Number(r.revenue),
  });
  const pending = inqRows.reduce((s, r) => s + Number(r.pending), 0);
  const confirmed = inqRows.reduce((s, r) => s + Number(r.confirmed), 0);

  const out = {
    range: { from, to, unit },
    totals: totals(cur),
    previous: totals(prev),
    series: {
      labels: buckets.map((b) => b.label),
      revenue: sumInto(buckets, revRows),
      inquiries: sumInto(buckets, inqRows),
      admissions: sumInto(buckets, admRows),
    },
    paymentMethods: methodRows.map((r) => ({
      label: r.label,
      amount: Number(r.amount),
      count: Number(r.count),
    })),
    admissionsByCourse: courseRows.map((r) => ({ label: r.label, count: Number(r.count) })),
    inquiryStatus: { pending, confirmed },
    recent: recent.map((r) => ({
      type: r.type,
      id: r.id,
      name: r.name,
      detail: r.detail,
      amount: r.amount === null ? null : Number(r.amount),
      date: r.date,
      at: r.at,
    })),
  };

  // Show only what this user may view (a staff role may have a single module).
  const visible = {
    students: can(req.admin, "students", "view"),
    inquiries: can(req.admin, "inquiries", "view"),
    admissions: can(req.admin, "admissions", "view"),
    revenue: can(req.admin, "payments", "view"),
  };
  const zero = (list) => list.map(() => 0);
  for (const t of [out.totals, out.previous]) {
    for (const k of Object.keys(visible)) if (!visible[k]) t[k] = 0;
  }
  if (!visible.revenue) {
    out.series.revenue = zero(out.series.revenue);
    out.paymentMethods = [];
  }
  if (!visible.inquiries) {
    out.series.inquiries = zero(out.series.inquiries);
    out.inquiryStatus = { pending: 0, confirmed: 0 };
  }
  if (!visible.admissions) {
    out.series.admissions = zero(out.series.admissions);
    out.admissionsByCourse = [];
  }
  const typeVisible = { inquiry: visible.inquiries, admission: visible.admissions, payment: visible.revenue };
  out.recent = out.recent.filter((r) => typeVisible[r.type]);
  out.visible = visible;
  res.json(out);
});


module.exports = { summary, income, recentPayments, overview };
