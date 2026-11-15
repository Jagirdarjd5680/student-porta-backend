const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const env = require("../config/env");

fs.mkdirSync(env.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, randomName(ext));
  },
});

// Unguessable file names (128 random bits).
const randomName = (ext) => `${crypto.randomBytes(16).toString("hex")}${ext}`;

function onlyExtensions(allowed) {
  return (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    if (allowed.includes(ext)) return cb(null, true);
    const err = new Error(
      `Only ${allowed.join(", ").toUpperCase()} files are allowed`,
    );
    err.status = 400;
    cb(err);
  };
}

const photoUpload = multer({
  storage,
  limits: { fileSize: env.maxPhotoMb * 1024 * 1024 },
  fileFilter: onlyExtensions(["jpg", "jpeg", "png", "gif", "webp"]),
});

const materialUpload = multer({
  storage,
  limits: { fileSize: env.maxFileMb * 1024 * 1024 },
  fileFilter: onlyExtensions(["pdf", "jpg", "jpeg", "png", "gif", "doc", "docx"]),
});

fs.mkdirSync(path.join(env.privateDir, "certificates"), { recursive: true });
const privateStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(env.privateDir, "certificates")),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, randomName(ext));
  },
});
const certificateUpload = multer({
  storage: privateStorage,
  limits: { fileSize: env.maxFileMb * 1024 * 1024 },
  fileFilter: onlyExtensions(["pdf", "jpg", "jpeg", "png", "webp"]),
});
const certificatePath = (fileName) => path.join(env.privateDir, "certificates", path.basename(fileName));
function removeCertificateFile(fileName) {
  if (!fileName) return;
  fs.unlink(certificatePath(fileName), () => {});
}

function removeFile(fileName) {
  if (!fileName) return;
  fs.unlink(path.join(env.uploadDir, path.basename(fileName)), () => {});
}

// Copy an existing upload under a new name (e.g. inquiry photo -> admission).
// Returns the new file name, or null if the source is missing.
function copyFile(fileName) {
  if (!fileName) return null;
  const src = path.join(env.uploadDir, path.basename(fileName));
  if (!fs.existsSync(src)) return null;
  const ext = path.extname(src).toLowerCase();
  const name = randomName(ext);
  fs.copyFileSync(src, path.join(env.uploadDir, name));
  return name;
}

module.exports = {
  photoUpload,
  materialUpload,
  certificateUpload,
  certificatePath,
  removeCertificateFile,
  removeFile,
  copyFile,
};
