const db = require("../config/db");
const env = require("../config/env");
const settings = require("../services/settings");
const { sendMail, smtpConfig } = require("../services/mailer");
const { can } = require("../utils/permissions");
const { assertOwned } = require("../utils/scope");
const { asyncHandler, httpError } = require("../utils/http");

const KINDS = {
  inquiry: { table: "inquiries", module: "inquiries", name: "student_name", no: "inquiry_no" },
  admission: { table: "admissions", module: "admissions", name: "student_name", no: "admission_no" },
  student: { table: "students", module: "students", name: "CONCAT_WS(' ', first_name, last_name)", no: "student_code" },
};

const MAX_PDF = 8 * 1024 * 1024;
const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fileName = (n) => `${String(n || "document").replace(/\.pdf$/i, "").replace(/[^\w.\- ]+/g, "_").slice(0, 80)}.pdf`;

/** Attachments from the browser: only real PDFs, small, at most three. */
function readPdfs(list) {
  if (!Array.isArray(list)) return [];
  if (list.length > 3) throw httpError(400, "Too many attachments");
  return list.map((p) => {
    const buf = Buffer.from(String(p?.data || ""), "base64");
    if (!buf.length || buf.length > MAX_PDF || buf.subarray(0, 4).toString() !== "%PDF") {
      throw httpError(400, "Attachment is not a valid PDF");
    }
    return { filename: fileName(p.name), content: buf, contentType: "application/pdf" };
  });
}

function compose(kind, who, no, inst, hasFiles) {
  const sign = [inst.name, inst.phone && `Phone: ${inst.phone}`, inst.email && `Email: ${inst.email}`, inst.website].filter(Boolean);
  const attach = hasFiles ? "Please find your form attached as a PDF." : "";
  const site = env.corsOrigin[0] || "";
  let subject;
  let lines;
  if (kind === "inquiry") {
    subject = `Your inquiry ${no}${inst.name ? ` - ${inst.name}` : ""}`;
    lines = [`Dear ${who},`, "", "Thank you for your inquiry. We have received it and will contact you soon.", attach];
  } else if (kind === "admission") {
    subject = `Your admission ${no}${inst.name ? ` - ${inst.name}` : ""}`;
    lines = [`Dear ${who},`, "", "Your admission has been recorded. Welcome!", attach];
  } else {
    subject = `Welcome${inst.name ? ` to ${inst.name}` : ""} - Student ID ${no}`;
    lines = [
      `Dear ${who},`,
      "",
      "Your student account has been created.",
      `Student ID: ${no}`,
      site ? `Sign in: ${site}/signin (use your Student ID and the password given by the institute)` : "",
      hasFiles ? "Your admission and inquiry forms are attached as PDFs." : "",
    ];
  }
  const text = [...lines.filter((l) => l !== ""), "", "Regards,", ...sign].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">${lines
    .map((l) => (l === "" ? "<br>" : `<p style="margin:0 0 6px">${esc(l)}</p>`))
    .join("")}<p style="margin-top:18px">Regards,<br>${sign.map(esc).join("<br>")}</p></div>`;
  return { subject, text, html };
}

// Emails the PDFs the browser just generated to the email saved on the record.
// The recipient is always read from the record, never from the request.
const sendRecord = asyncHandler(async (req, res) => {
  const kind = KINDS[req.body.kind];
  if (!kind) throw httpError(400, "Unknown kind");
  const id = Number(req.body.id);
  if (!id) throw httpError(400, "Missing id");
  if (!can(req.admin, kind.module, "add")) throw httpError(403, "You don't have permission to do this");
  await assertOwned(req, kind.table, id);

  const [[rec]] = await db.query(`SELECT email, ${kind.name} AS who, ${kind.no} AS no FROM \`${kind.table}\` WHERE id = ?`, [id]);
  if (!rec) throw httpError(404, "Record not found");
  if (!rec.email) return res.json({ status: "no_email" });

  const stored = await settings.readAll();
  if (stored.mail_auto === "0") return res.json({ status: "disabled" });
  if (!(await smtpConfig()).host) return res.json({ status: "smtp_missing" });

  const pdfs = readPdfs(req.body.pdfs);
  const mail = compose(req.body.kind, rec.who || "Student", rec.no, await settings.getInstitute(), pdfs.length > 0);
  try {
    await sendMail({ to: rec.email, ...mail, attachments: pdfs });
  } catch (err) {
    return res.json({ status: "failed", message: err.message || "Could not send the email" });
  }
  res.json({ status: "sent", to: rec.email });
});

module.exports = { sendRecord };
