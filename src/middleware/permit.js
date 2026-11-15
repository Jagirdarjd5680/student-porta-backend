const { can, actionFor } = require("../utils/permissions");

/**
 * Route guard for one module. The HTTP method decides the action
 * (GET=view, POST=add, PUT/PATCH=edit, DELETE=delete).
 *
 * options.postAs:      treat POST as this action instead of "add" (e.g. "edit").
 * options.publicRead: any logged-in user may GET (dropdown lookups).
 * options.readAlso:   extra [module, action] pairs that also allow GET
 *                     (e.g. admissions "add" may list inquiries to convert).
 */
module.exports = function permit(module, options = {}) {
  return (req, res, next) => {
    const action = req.method === "POST" && options.postAs ? options.postAs : actionFor(req.method);
    if (action === "view") {
      if (options.publicRead) return next();
      if ((options.readAlso || []).some(([m, a]) => can(req.admin, m, a))) return next();
    }
    if (can(req.admin, module, action)) return next();
    return res.status(403).json({ message: "You don't have permission to do this" });
  };
};
