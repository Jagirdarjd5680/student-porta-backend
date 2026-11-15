const multer = require("multer");

function notFound(_req, res) {
  res.status(404).json({ message: "Route not found" });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE" ? "File is too large" : err.message;
    return res.status(400).json({ message });
  }
  if (err.code === "ER_ROW_IS_REFERENCED_2") {
    return res
      .status(400)
      .json({ message: "This record is in use and cannot be deleted" });
  }
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({
    message: status === 500 ? "Server error" : err.message,
  });
}

module.exports = { notFound, errorHandler };
