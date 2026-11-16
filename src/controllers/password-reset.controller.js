const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../config/db");
const { sendMail } = require("../services/mailer");
const settings = require("../services/settings");
const { asyncHandler, httpError, requireFields } = require("../utils/http");

// Forgot password in 3 steps: 1) email -> OTP mailed, 2) OTP -> short-lived reset token,
// 3) reset token + new password. Works for admin/staff (email) and students (email on file).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_MINUTES = 10;
const RESET_MINUTES = 15;
const MAX_TRIES = 5;
const RESEND_SECONDS = 45;

const sha = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");
const same = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const cleanEmail = (v) => String(v || "").trim().toLowerCase();

async function ensureTable() {
  await db.query(
    `CREATE TABLE IF NOT EXISTS password_resets (
       email VARCHAR(150) PRIMARY KEY,
       otp_hash VARCHAR(64) NOT NULL,
       otp_expires DATETIME NOT NULL,
       tries INT NOT NULL DEFAULT 0,
       reset_hash VARCHAR(64) NULL,
       reset_expires DATETIME NULL,
       created_at DATETIME NOT NULL
     )`,
  );
}
let ready;
const table = () => (ready ||= ensureTable().catch((e) => ((ready = null), Promise.reject(e))));

/** Does this email belong to an admin/staff user or a student with a portal login? */
async function accountExists(email) {
  const [[a]] = await db.query("SELECT id FROM admins WHERE email = ?", [email]);
  if (a) return true;
  const [[s]] = await db.query("SELECT id FROM students WHERE LOWER(email) = ? AND password_hash IS NOT NULL LIMIT 1", [email]);
  return Boolean(s);
}

const sendCode = asyncHandler(async (req, res) => {
  requireFields(req.body, [["email", "Email"]]);
  const email = cleanEmail(req.body.email);
  if (!EMAIL_RE.test(email)) throw httpError(400, "Please enter a valid email");
  await table();

  // Same answer whether or not the email is registered, so emails cannot be probed.
  const reply = { success: true, message: "If this email is registered, a 6-digit code has been sent to it." };
  if (!(await accountExists(email))) return res.json(reply);

  const [[old]] = await db.query("SELECT created_at FROM password_resets WHERE email = ?", [email]);
  if (old && Date.now() - new Date(old.created_at).getTime() < RESEND_SECONDS * 1000) {
    throw httpError(429, `Please wait ${RESEND_SECONDS} seconds before asking for a new code.`);
  }

  const otp = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await db.query(
    `REPLACE INTO password_resets (email, otp_hash, otp_expires, tries, reset_hash, reset_expires, created_at)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), 0, NULL, NULL, NOW())`,
    [email, sha(`${email}:${otp}`), OTP_MINUTES],
  );

  const inst = await settings.getInstitute().catch(() => ({}));
  const name = inst.name || "Password reset";
  try {
    await sendMail({
      to: email,
      subject: `${otp} is your password reset code${inst.name ? ` - ${inst.name}` : ""}`,
      text: `Your password reset code is ${otp}.\nIt is valid for ${OTP_MINUTES} minutes. If you did not ask for it, ignore this mail.\n\n${name}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222"><p>Your password reset code is</p><p style="font-size:28px;letter-spacing:6px;font-weight:bold">${otp}</p><p>It is valid for ${OTP_MINUTES} minutes. If you did not ask for it, ignore this mail.</p><p>${name}</p></div>`,
    });
  } catch (err) {
    await db.query("DELETE FROM password_resets WHERE email = ?", [email]);
    console.error("Password reset mail failed:", err.message);
    throw httpError(502, "Could not send the email. Please contact the institute.");
  }
  res.json(reply);
});

const verifyCode = asyncHandler(async (req, res) => {
  requireFields(req.body, [
    ["email", "Email"],
    ["otp", "Code"],
  ]);
  const email = cleanEmail(req.body.email);
  await table();
  const [[row]] = await db.query("SELECT *, otp_expires < NOW() AS expired FROM password_resets WHERE email = ?", [email]);
  if (!row || row.reset_hash || row.expired) throw httpError(400, "This code has expired. Please ask for a new one.");
  if (row.tries >= MAX_TRIES) throw httpError(429, "Too many wrong codes. Please ask for a new one.");

  if (!same(row.otp_hash, sha(`${email}:${String(req.body.otp).trim()}`))) {
    await db.query("UPDATE password_resets SET tries = tries + 1 WHERE email = ?", [email]);
    throw httpError(400, "Wrong code. Please check and try again.");
  }
  const resetToken = crypto.randomBytes(32).toString("hex");
  await db.query(
    "UPDATE password_resets SET reset_hash = ?, reset_expires = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE email = ?",
    [sha(resetToken), RESET_MINUTES, email],
  );
  res.json({ success: true, reset_token: resetToken });
});

const resetPassword = asyncHandler(async (req, res) => {
  requireFields(req.body, [
    ["email", "Email"],
    ["reset_token", "Reset token"],
    ["new_password", "New password"],
  ]);
  const email = cleanEmail(req.body.email);
  const next = String(req.body.new_password);
  if (next.length < 8) throw httpError(400, "Password must be at least 8 characters");
  if (next !== String(req.body.confirm_password || "")) throw httpError(400, "Passwords do not match");
  await table();

  const [[row]] = await db.query("SELECT *, reset_expires < NOW() AS expired FROM password_resets WHERE email = ?", [email]);
  if (!row || !row.reset_hash || row.expired || !same(row.reset_hash, sha(req.body.reset_token))) {
    throw httpError(400, "This reset link has expired. Please start again.");
  }

  const hash = await bcrypt.hash(next, 10);
  // Admin tokens are tied to the password hash; student tokens to token_version: both sign out old sessions.
  await db.query("UPDATE admins SET password_hash = ? WHERE email = ?", [hash, email]);
  await db.query(
    "UPDATE students SET password_hash = ?, token_version = token_version + 1 WHERE LOWER(email) = ? AND password_hash IS NOT NULL",
    [hash, email],
  );
  await db.query("DELETE FROM password_resets WHERE email = ?", [email]);
  res.json({ success: true, message: "Password changed. You can sign in now." });
});

module.exports = { sendCode, verifyCode, resetPassword };
