/** The session cookie hutch sets on login. Host-only (path "/", no domain), so
 * the browser sends it to every same-origin surface — hutch, /blog, /embed —
 * even though only hutch writes it. Single-sourced here so every deployable that
 * reads or writes the cookie agrees on the name. */
export const SESSION_COOKIE_NAME = "hutch_sid";
