const express = require("express");
const auth = require("../middleware/auth");
const permit = require("../middleware/permit");
const { scoped } = require("../utils/scope");
const { photoUpload, materialUpload, certificateUpload } = require("../middleware/upload");

const authCtrl = require("../controllers/auth.controller");
const master = require("../controllers/master.controller");
const courses = require("../controllers/courses.controller");
const inquiries = require("../controllers/inquiries.controller");
const admissions = require("../controllers/admissions.controller");
const students = require("../controllers/students.controller");
const payments = require("../controllers/payments.controller");
const refunds = require("../controllers/refunds.controller");
const materials = require("../controllers/study-materials.controller");
const dashboard = require("../controllers/dashboard.controller");
const reports = require("../controllers/reports.controller");
const users = require("../controllers/users.controller");
const settingsCtrl = require("../controllers/settings.controller");
const studentAuth = require("../middleware/student-auth");
const portal = require("../controllers/student-portal.controller");
const certificates = require("../controllers/certificates.controller");
const mailCtrl = require("../controllers/mail.controller");
const files = require("../controllers/files.controller");
const eitherAuth = require("../middleware/either-auth");
const { loginLimiter, sensitiveLimiter, mailLimiter } = require("../middleware/security");

const router = express.Router();

// Public
router.post("/auth/login", loginLimiter, authCtrl.login);

// Uploaded images: admin or student token required (served by the web app on behalf of a signed-in user)
router.get("/photos/:name", eitherAuth, files.photo);

// Student portal (separate login + token; admin tokens do not work here)
router.post("/student/auth/login", loginLimiter, portal.login);
router.use("/student", studentAuth);
router.get("/student/access", (req, res) => res.json({ menus: req.student.menus }));
router.get("/student/me", portal.me);
router.post("/student/password", sensitiveLimiter, portal.changePassword);
router.get("/student/materials", studentAuth.needMenu("materials"), portal.materials);
router.get("/student/payments", studentAuth.needMenu("payments"), portal.payments);
router.get("/student/certificates", studentAuth.needMenu("certificates"), certificates.mine);
router.get("/student/certificates/:id/file", studentAuth.needMenu("certificates"), certificates.mineFile);
router.get("/student/payments/:id/invoice", studentAuth.needMenu("payments"), portal.invoice);

// Everything below needs a logged-in admin
router.use(auth);
router.get("/auth/me", authCtrl.me);
router.post("/mail/record", mailLimiter, mailCtrl.sendRecord);
router.put("/auth/profile", photoUpload.single("photo"), authCtrl.updateProfile);
router.post("/auth/password", sensitiveLimiter, authCtrl.changePassword);

// Permission guards per module (GET=view, POST=add, PUT/PATCH=edit, DELETE=delete).
// Lookups used by dropdowns stay readable for every logged-in user.
router.use("/categories", permit("categories", { publicRead: true }));
router.use("/durations", permit("durations", { publicRead: true }));
router.use("/courses", permit("courses", { publicRead: true }));
router.use("/inquiries", permit("inquiries", { readAlso: [["admissions", "add"], ["admissions", "view"]] }));
router.use("/admissions", permit("admissions", { readAlso: [["students", "add"]] }));
router.use("/students", permit("students", { readAlso: [["payments", "view"], ["payments", "add"], ["refunds", "view"], ["refunds", "add"], ["certificates", "view"], ["certificates", "add"], ["certificates", "edit"]] }));
router.use("/payments", permit("payments"));
router.use("/refunds", permit("refunds"));
router.use("/study-materials", permit("study_materials"));
router.use("/reports", permit("reports"));
router.use("/certificates", permit("certificates"));
router.use("/users", permit("roles"));

// Institute details are needed by every PDF, so any logged-in user may read them.
router.get("/settings/institute", settingsCtrl.institute);
router.get("/settings/appearance", settingsCtrl.appearance);
router.use("/settings", permit("settings", { postAs: "edit" }));
router.get("/settings", settingsCtrl.get);
router.put("/settings", settingsCtrl.save);
router.post("/settings/smtp/test", sensitiveLimiter, settingsCtrl.testSmtp);

router.get("/users/meta", users.meta);
router.get("/users", users.list);
router.post("/users", users.create);
router.put("/users/:id", users.update);
router.delete("/users/:id", users.remove);

router.get("/dashboard/overview", dashboard.overview);

router.get("/receptionists", master.listReceptionists);

router.get("/categories", master.listCategories);
router.post("/categories", master.saveCategory);
router.put("/categories/:id", master.saveCategory);
router.delete("/categories/:id", master.deleteCategory);

router.get("/durations", master.listDurations);
router.post("/durations", master.saveDuration);
router.put("/durations/:id", master.saveDuration);
router.delete("/durations/:id", master.deleteDuration);

router.get("/courses", courses.list);
router.post("/courses", courses.save);
router.put("/courses/:id", courses.save);
router.delete("/courses/:id", courses.remove);

router.get("/inquiries", inquiries.list);
router.get("/inquiries/stats", inquiries.stats);
router.get("/inquiries/institute", inquiries.institute);
router.get("/inquiries/:id", scoped("inquiries"), inquiries.getOne);
router.post("/inquiries", photoUpload.single("photo"), inquiries.create);
router.put("/inquiries/:id", scoped("inquiries"), photoUpload.single("photo"), inquiries.update);
router.patch("/inquiries/:id/status", scoped("inquiries"), inquiries.updateStatus);
router.delete("/inquiries/:id", scoped("inquiries"), inquiries.remove);

router.get("/admissions", admissions.list);
router.get("/admissions/stats", admissions.stats);
router.get("/admissions/:id", scoped("admissions"), admissions.getOne);
router.post("/admissions", photoUpload.single("photo"), admissions.create);
router.put("/admissions/:id", scoped("admissions"), photoUpload.single("photo"), admissions.update);
router.patch("/admissions/:id/status", scoped("admissions"), admissions.updateStatus);
router.delete("/admissions/:id", scoped("admissions"), admissions.remove);

router.get("/students", students.list);
router.get("/students/:id", scoped("students"), students.getOne);
router.post("/students", photoUpload.single("photo"), students.create);
router.put("/students/:id", scoped("students"), photoUpload.single("photo"), students.update);
router.delete("/students/:id", scoped("students"), students.remove);

router.get("/payments", payments.list);
router.post("/payments", payments.create);
router.get("/payments/:id/invoice", scoped("payments"), payments.invoice);
router.delete("/payments/:id", scoped("payments"), payments.remove);

router.get("/refunds", refunds.list);
router.post("/refunds", refunds.create);

router.get("/study-materials", materials.list);
router.get("/study-materials/topics", materials.topics);
router.post("/study-materials", materialUpload.single("file"), materials.create);
router.put("/study-materials/:id", materialUpload.single("file"), materials.update);
router.delete("/study-materials/:id", materials.remove);

router.get("/reports/payments", reports.payments);

router.get("/certificates", certificates.list);
router.get("/certificates/:id/file", certificates.file);
router.post("/certificates", certificateUpload.single("file"), certificates.create);
router.put("/certificates/:id", certificateUpload.single("file"), certificates.update);
router.delete("/certificates/:id", certificates.remove);

module.exports = router;
