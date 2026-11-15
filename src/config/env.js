const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const list = (value, sep = ",") =>
  (value || "")
    .split(sep)
    .map((v) => v.trim())
    .filter(Boolean);

const isProd = process.env.NODE_ENV === "production";
const WEAK_SECRETS = ["", "change_this_secret", "secret", "changeme"];
const secret = process.env.JWT_SECRET || "";
if (WEAK_SECRETS.includes(secret) || secret.length < 32) {
  const msg =
    "JWT_SECRET is missing or weak: set a random value of at least 32 characters in backend/.env " +
    "(generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\").";
  if (isProd) {
    console.error(msg);
    process.exit(1);
  }
  console.warn(`WARNING: ${msg}`);
}

const env = {
  isProd,
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : false,
  port: Number(process.env.PORT || 5000),
  corsOrigin: list(process.env.CORS_ORIGIN || "http://localhost:3000"),
  db: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "gog_student_panel",
  },
  jwtSecret: secret || "change_this_secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  admin: {
    name: process.env.ADMIN_NAME || "Admin",
    email: process.env.ADMIN_EMAIL || "admin@example.com",
    password: process.env.ADMIN_PASSWORD || "admin123",
  },
  uploadDir: path.resolve(
    __dirname,
    "../..",
    process.env.UPLOAD_DIR || "uploads",
  ),
  // Not exposed as static files: certificates are sent only to logged-in owners.
  privateDir: path.resolve(__dirname, "../..", "private"),
  maxPhotoMb: Number(process.env.MAX_PHOTO_MB || 10),
  maxFileMb: Number(process.env.MAX_FILE_MB || 20),
  institute: {
    name: process.env.INSTITUTE_NAME || "",
    address: process.env.INSTITUTE_ADDRESS || "",
    phone: process.env.INSTITUTE_PHONE || "",
    email: process.env.INSTITUTE_EMAIL || "",
    gstin: process.env.INSTITUTE_GSTIN || "",
    terms: list(process.env.INVOICE_TERMS, "|"),
  },
};

module.exports = env;
