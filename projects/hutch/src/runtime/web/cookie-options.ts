/** `secure` must be true in any HTTPS deployment and false for local http dev —
 * browsers drop Secure cookies over plain HTTP, which would silently break
 * login on http://localhost. Derive it from the serving origin scheme via
 * `isHttpsOrigin` rather than NODE_ENV so it follows the actual transport. */
export function baseCookieOptions(secure: boolean) {
	return { httpOnly: true, sameSite: "lax" as const, path: "/", secure };
}

export function isHttpsOrigin(origin: string): boolean {
	return new URL(origin).protocol === "https:";
}
