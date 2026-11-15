// Menus of the student portal. "dashboard" is always available.
const MENUS = ["course", "materials", "profile", "payments", "certificates"];

/** Allowed menus from the stored JSON (NULL = everything). Always includes the dashboard. */
function parseMenus(text) {
  let list = MENUS;
  if (text) {
    try {
      const raw = JSON.parse(text);
      list = Array.isArray(raw) ? MENUS.filter((m) => raw.includes(m)) : MENUS;
    } catch {
      list = MENUS;
    }
  }
  return ["dashboard", ...list];
}

/** Keep only known menus: accepts an array or a JSON string. Returns a JSON string. */
function sanitizeMenus(input) {
  let raw = input;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [];
    }
  }
  return JSON.stringify(MENUS.filter((m) => Array.isArray(raw) && raw.includes(m)));
}

module.exports = { MENUS, parseMenus, sanitizeMenus };
