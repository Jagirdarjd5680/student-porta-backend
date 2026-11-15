const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const tooMany = (message) => ({ message });

const limiter = (windowMs, limit, message, extra = {}) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: tooMany(message),
    ...extra,
  });

// Security headers. The API serves JSON and uploaded files to the web app on another origin,
// so cross-origin reads of those files stay allowed (CORS itself is restricted in app.js).
const headers = helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  referrerPolicy: { policy: "no-referrer" },
});

// Calls the web server makes on behalf of every signed-in user (session check, images) all
// come from one IP, so they get their own, much higher limit; each still needs a valid token.
const isServerCall = (req) =>
  req.path === "/auth/me" || req.path === "/student/access" || req.path.startsWith("/photos/");
const serverLimiter = limiter(60 * 1000, 6000, "Too many requests. Please slow down.", {
  skip: (req) => !isServerCall(req),
});

// Every other API call, per IP.
const apiLimiter = limiter(60 * 1000, 300, "Too many requests. Please slow down.", {
  skip: isServerCall,
});

// Password guessing: admin + student login, per IP (student login also has a per Student-ID brake).
const loginLimiter = limiter(15 * 60 * 1000, 20, "Too many login attempts. Please try again after 15 minutes.", {
  skipSuccessfulRequests: true,
});

// Actions that cost money / send mail / change passwords.
const sensitiveLimiter = limiter(15 * 60 * 1000, 30, "Too many attempts. Please try again later.");
const mailLimiter = limiter(60 * 1000, 20, "Too many emails requested. Please wait a minute.");

// Query strings may only carry plain text values: `?a[b]=1` / `?a=1&a=2` become objects /
// arrays in Express, which is the classic way to smuggle structure into a query.
function plainQuery(req, res, next) {
  for (const value of Object.values(req.query)) {
    if (typeof value !== "string") return res.status(400).json({ message: "Invalid request" });
  }
  next();
}


module.exports = { headers, apiLimiter, serverLimiter, loginLimiter, sensitiveLimiter, mailLimiter, plainQuery };
