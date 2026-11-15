const nodemailer = require("nodemailer");
const settings = require("./settings");

/** SMTP config from saved settings, optionally overridden (used by "Send test"). */
async function smtpConfig(override = {}) {
  const s = { ...(await settings.readAll()), ...override };
  return {
    host: String(s.smtp_host || "").trim(),
    port: Number(s.smtp_port) || 587,
    secure: s.smtp_secure === "ssl", // "ssl" = implicit TLS (465); "tls" = STARTTLS (587); "none"
    requireTLS: s.smtp_secure === "tls",
    user: String(s.smtp_user || "").trim(),
    pass: s.smtp_pass || "",
    fromName: String(s.smtp_from_name || "").trim(),
    fromEmail: String(s.smtp_from_email || s.smtp_user || "").trim(),
  };
}

function transporter(c) {
  return nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    requireTLS: c.requireTLS,
    ignoreTLS: false,
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

/** Send a mail with the saved SMTP settings. Throws a readable Error on failure. */
async function sendMail({ to, subject, text, html, attachments }, override) {
  const c = await smtpConfig(override);
  if (!c.host) throw new Error("SMTP host is not configured (Settings → Email)");
  if (!c.fromEmail) throw new Error("From email is not configured (Settings → Email)");
  const info = await transporter(c).sendMail({
    from: c.fromName ? `"${c.fromName.replace(/"/g, "")}" <${c.fromEmail}>` : c.fromEmail,
    to,
    subject,
    text,
    html,
    attachments,
  });
  return info;
}

module.exports = { sendMail, smtpConfig };
