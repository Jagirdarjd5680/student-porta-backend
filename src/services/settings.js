// App settings stored in the `settings` table (key/value), with .env fallbacks.
const crypto = require("crypto");
const db = require("../config/db");
const env = require("../config/env");

// Keys that can be saved, grouped by tab. `secret` values are encrypted at rest.
const KEYS = {
  institute: ["inst_name", "inst_address", "inst_phone", "inst_email", "inst_website", "inst_gstin", "inst_terms"],
  smtp: ["smtp_host", "smtp_port", "smtp_secure", "smtp_user", "smtp_pass", "smtp_from_name", "smtp_from_email", "mail_auto"],
};
// Admin sidebar colours (hex like #ffffff; blank = the default look).
KEYS.sidebar = ["sb_bg", "sb_text", "sb_active_bg", "sb_active_text", "sb_hover_bg", "sb_hover_text"];
const ALL_KEYS = [...KEYS.institute, ...KEYS.smtp, ...KEYS.sidebar];
const SECRET_KEYS = ["smtp_pass"];

// AES-256-GCM with a key derived from JWT_SECRET (keep that secret stable!).
const key = () => crypto.createHash("sha256").update(`settings:${env.jwtSecret}`).digest();

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return `enc:${Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64")}`;
}

function decrypt(value) {
  if (!value?.startsWith("enc:")) return value || "";
  try {
    const raw = Buffer.from(value.slice(4), "base64");
    const d = crypto.createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return ""; // JWT_SECRET changed: the stored password can't be read, ask for it again
  }
}

/** All stored values, decrypted: { key: value }. */
async function readAll() {
  const [rows] = await db.query("SELECT `key`, `value` FROM settings");
  const out = {};
  for (const r of rows) out[r.key] = SECRET_KEYS.includes(r.key) ? decrypt(r.value) : r.value ?? "";
  return out;
}

/** Save only the given keys (unknown keys are ignored). Secrets are encrypted. */
async function saveMany(values) {
  for (const k of ALL_KEYS) {
    if (!(k in values)) continue;
    let v = values[k] == null ? "" : String(values[k]).trim();
    if (SECRET_KEYS.includes(k) && v) v = encrypt(v);
    await db.query(
      "INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
      [k, v],
    );
  }
}

const pick = (stored, key, fallback) => (stored[key] !== undefined && stored[key] !== "" ? stored[key] : fallback);

/** Institute details for PDFs: saved settings first, .env as fallback. */
async function getInstitute() {
  const s = await readAll();
  const e = env.institute;
  const terms = s.inst_terms
    ? s.inst_terms.split(/\r?\n/).map((t) => t.trim()).filter(Boolean)
    : e.terms;
  return {
    name: pick(s, "inst_name", e.name),
    address: pick(s, "inst_address", e.address),
    phone: pick(s, "inst_phone", e.phone),
    email: pick(s, "inst_email", e.email),
    website: pick(s, "inst_website", ""),
    gstin: pick(s, "inst_gstin", e.gstin),
    terms,
  };
}

module.exports = { KEYS, ALL_KEYS, SECRET_KEYS, readAll, saveMany, getInstitute };
