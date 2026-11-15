const settings = require("../services/settings");
const { sendMail, smtpConfig } = require("../services/mailer");
const { asyncHandler, httpError, cleanPhone } = require("../utils/http");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
const SECURE = ["none", "tls", "ssl"];

// Everything the Settings page needs. The SMTP password is never sent back.
const get = asyncHandler(async (_req, res) => {
  const s = await settings.readAll();
  const out = {};
  for (const k of settings.ALL_KEYS) out[k] = s[k] ?? "";
  out.mail_auto = s.mail_auto === "0" ? "0" : "1"; // automatic mail is on unless switched off
  out.smtp_pass = "";
  out.smtp_pass_set = Boolean(s.smtp_pass);
  // Show .env values as the starting point until something is saved.
  const inst = await settings.getInstitute();
  out.inst_name = out.inst_name || inst.name;
  out.inst_address = out.inst_address || inst.address;
  out.inst_phone = out.inst_phone || inst.phone;
  out.inst_email = out.inst_email || inst.email;
  out.inst_gstin = out.inst_gstin || inst.gstin;
  out.inst_terms = out.inst_terms || inst.terms.join("\n");
  res.json(out);
});

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function validate(b) {
  for (const k of settings.KEYS.sidebar) {
    if (k in b && b[k] !== "" && b[k] != null && !HEX_RE.test(String(b[k]).trim())) {
      throw httpError(400, "Sidebar colours must look like #c40c0c");
    }
  }
  if ("inst_name" in b && !String(b.inst_name).trim()) throw httpError(400, "Institute name is required");
  for (const k of ["inst_email", "smtp_from_email"]) {
    if (b[k] && !EMAIL_RE.test(String(b[k]).trim())) throw httpError(400, "Please enter a valid email address");
  }
  if (b.inst_gstin && !GSTIN_RE.test(String(b.inst_gstin).trim().toUpperCase())) {
    throw httpError(400, "GST number is not valid (15 characters, e.g. 08ABCDE1234F1Z5)");
  }
  if (b.smtp_port && !(Number(b.smtp_port) > 0 && Number(b.smtp_port) < 65536)) {
    throw httpError(400, "SMTP port must be between 1 and 65535");
  }
  if (b.smtp_secure && !SECURE.includes(b.smtp_secure)) throw httpError(400, "Invalid encryption type");
}

const save = asyncHandler(async (req, res) => {
  const b = { ...req.body };
  validate(b);
  if ("inst_phone" in b) b.inst_phone = b.inst_phone ? String(b.inst_phone).trim() : "";
  if (b.inst_gstin) b.inst_gstin = String(b.inst_gstin).trim().toUpperCase();
  if ("smtp_host" in b) b.smtp_host = String(b.smtp_host || "").trim();
  // Blank password = keep the saved one.
  if (!b.smtp_pass) delete b.smtp_pass;
  delete b.smtp_pass_set;
  await settings.saveMany(b);
  res.json({ success: true });
});

// Readable message for the common SMTP failures.
function smtpMessage(err) {
  const code = err.code || "";
  if (code === "EAUTH") return "Login failed: check SMTP username and password (Gmail needs an App Password).";
  if (code === "ESOCKET" || code === "ECONNECTION") return `Could not connect to the SMTP server: ${err.message}`;
  if (code === "ETIMEDOUT" || code === "ECONNREFUSED") return "SMTP server did not respond: check host, port and encryption.";
  if (code === "ENOTFOUND" || code === "EDNS") return "SMTP host not found: check the host name.";
  return err.message || "Could not send the test email";
}

const testSmtp = asyncHandler(async (req, res) => {
  const to = String(req.body.to || "").trim();
  if (!EMAIL_RE.test(to)) throw httpError(400, "Enter a valid email address to send the test to");
  // Use what is on screen; a blank password falls back to the saved one.
  const override = {};
  for (const k of ["smtp_host", "smtp_port", "smtp_secure", "smtp_user", "smtp_from_name", "smtp_from_email"]) {
    if (req.body[k] !== undefined && req.body[k] !== "") override[k] = req.body[k];
  }
  if (req.body.smtp_pass) override.smtp_pass = req.body.smtp_pass;
  const c = await smtpConfig(override);
  try {
    await sendMail(
      {
        to,
        subject: "Test email from your admin panel",
        text: `This is a test email.\n\nIf you can read this, your SMTP settings (${c.host}:${c.port}) work.`,
        html: `<p>This is a test email.</p><p>If you can read this, your SMTP settings (<b>${c.host}:${c.port}</b>) work.</p>`,
      },
      override,
    );
  } catch (err) {
    throw httpError(400, smtpMessage(err));
  }
  res.json({ success: true });
});

// Sidebar colours: every logged-in user's sidebar uses them.
const appearance = asyncHandler(async (_req, res) => {
  const s = await settings.readAll();
  const out = {};
  for (const k of settings.KEYS.sidebar) out[k] = HEX_RE.test(s[k] || "") ? s[k].toLowerCase() : "";
  res.json(out);
});

// Institute details for PDFs: readable by every logged-in user.
const institute = asyncHandler(async (_req, res) => {
  res.json(await settings.getInstitute());
});

module.exports = { get, save, testSmtp, institute, appearance };
