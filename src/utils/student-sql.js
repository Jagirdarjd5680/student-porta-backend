// Shared SELECT for students with course, duration, total paid and balance.
const STUDENT_SELECT = `
  SELECT s.id, s.student_code, s.first_name, s.last_name, s.email, s.phone, s.dob,
    s.admission_date, s.address, s.course_id, s.duration_id, s.course_fee,
    s.discount_type, s.discount_value, s.discount_amount, s.total_fee, s.photo,
    s.portal_menus, s.created_by, s.password_hash IS NOT NULL AS has_password, s.created_at,
    CONCAT_WS(' ', s.first_name, s.last_name) AS full_name,
    c.name AS course_name,
    d.name AS duration_name,
    COALESCE(p.total_paid, 0) AS total_paid,
    s.total_fee - COALESCE(p.total_paid, 0) AS balance
  FROM students s
  LEFT JOIN courses c ON c.id = s.course_id
  LEFT JOIN durations d ON d.id = s.duration_id
  LEFT JOIN (
    SELECT student_id, SUM(amount) AS total_paid FROM payments GROUP BY student_id
  ) p ON p.student_id = s.id`;

// Discount -> { discountAmount, totalFee }
function calcFee(courseFee, discountType, discountValue) {
  const fee = Number(courseFee) || 0;
  const value = Math.max(Number(discountValue) || 0, 0);
  let discountAmount =
    discountType === "percentage" ? (fee * Math.min(value, 100)) / 100 : value;
  discountAmount = Math.min(Math.round(discountAmount * 100) / 100, fee);
  return { discountAmount, totalFee: Math.round((fee - discountAmount) * 100) / 100 };
}

module.exports = { STUDENT_SELECT, calcFee };
