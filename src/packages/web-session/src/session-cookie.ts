import { SESSION_TTL_SECONDS } from "./session-row";

/** The session cookie hutch sets on login. Host-only (path "/", no domain), so
 * the browser sends it to every same-origin surface — hutch, /blog, /embed —
 * even though only hutch writes it. Single-sourced here so every deployable that
 * reads or writes the cookie agrees on the name. */
export const SESSION_COOKIE_NAME = "hutch_sid";

/** Persist the session cookie for the full server-side session lifetime instead
 * of leaving it a bare session cookie, which the browser drops the moment it
 * fully closes (why iOS Chrome-first login stopped reusing an existing web
 * session across a Chrome restart). Bounded by — never outliving — the same TTL
 * that evicts the session row, so a cookie sent past it resolves to no session.
 * `res.cookie`'s `maxAge` is milliseconds; `SESSION_TTL_SECONDS` is seconds. */
export const SESSION_COOKIE_MAX_AGE_MS = SESSION_TTL_SECONDS * 1000;
