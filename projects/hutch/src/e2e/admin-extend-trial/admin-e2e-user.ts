/** Shared between the e2e server (which must allowlist this address for the
 * admin gate) and the extend-trial flow (which logs in as it). One module so
 * the two processes can never drift. A user of its own so the parallel
 * queue-flow and oauth-revoke specs never share a session with this flow. */
export const E2E_ADMIN_EMAIL = 'admin-e2e@example.com'
export const E2E_ADMIN_PASSWORD = 'admin-password-123'
