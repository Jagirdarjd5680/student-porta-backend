// Modules a staff user can be given access to, and the actions per module.
const MODULES = [
  "inquiries",
  "admissions",
  "students",
  "courses",
  "categories",
  "durations",
  "study_materials",
  "payments",
  "refunds",
  "reports",
  "roles",
  "settings",
  "certificates",
];
const ACTIONS = ["view", "add", "edit", "delete"];

// Keep only known modules/actions: { inquiries: ["view","add"], ... }
function sanitizePermissions(input) {
  let raw = input;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = {};
    }
  }
  const out = {};
  for (const m of MODULES) {
    const acts = Array.isArray(raw?.[m]) ? raw[m].filter((a) => ACTIONS.includes(a)) : [];
    if (acts.length) out[m] = [...new Set(acts)];
  }
  return out;
}

function parsePermissions(text) {
  return sanitizePermissions(text || "{}");
}

function can(user, module, action) {
  if (!user) return false;
  if (user.is_super) return true;
  return Boolean(user.permissions?.[module]?.includes(action));
}

// HTTP method -> action.
const actionFor = (method) =>
  method === "GET" ? "view" : method === "POST" ? "add" : method === "DELETE" ? "delete" : "edit";

module.exports = { MODULES, ACTIONS, sanitizePermissions, parsePermissions, can, actionFor };
