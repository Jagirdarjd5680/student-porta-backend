const jwt = require("jsonwebtoken");
const env = require("../config/env");
const auth = require("./auth");
const studentAuth = require("./student-auth");

// Runs the admin check or the student check depending on whose token this is.
module.exports = function eitherAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Unauthorized" });
  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] });
  } catch {
    return res.status(401).json({ message: "Unauthorized" });
  }
  return payload.role === "student" ? studentAuth(req, res, next) : auth(req, res, next);
};
