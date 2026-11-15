const express = require("express");
const cors = require("cors");
const env = require("./config/env");
const routes = require("./routes");
const { notFound, errorHandler } = require("./middleware/error");
const { headers, apiLimiter, serverLimiter, plainQuery } = require("./middleware/security");

const IMAGE_RE = /\.(jpe?g|png|gif|webp)$/i;

const app = express();

// Set TRUST_PROXY (e.g. "1") only when running behind a reverse proxy, so rate limits see the real IP.
if (env.trustProxy) app.set("trust proxy", env.trustProxy);
app.disable("x-powered-by");
app.use(headers);

app.use(
  cors({
    origin: env.corsOrigin,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  }),
);
// Generated PDFs are posted as base64 to /api/mail: allow a larger body only there.
app.use("/api/mail", express.json({ limit: "25mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// Images (photos) are never served from here: they need a login, see /api/photos/:name.
// Only documents (PDF / Word) stay on this plain link.
app.use("/uploads", (req, res, next) =>
  IMAGE_RE.test(req.path) ? res.status(404).json({ message: "Not found" }) : next(),
);
app.use(
  "/uploads",
  express.static(env.uploadDir, { index: false, dotfiles: "deny", redirect: false }),
);

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api", serverLimiter, apiLimiter, plainQuery, routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
