const crypto = require("crypto");

// Short fingerprint of a password hash, stored in admin tokens.
const passwordVersion = (hash) => crypto.createHash("sha256").update(String(hash || "")).digest("hex").slice(0, 16);

module.exports = { passwordVersion };
