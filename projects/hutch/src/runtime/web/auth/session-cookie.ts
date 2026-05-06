export const SESSION_COOKIE_NAME = "hutch_sid";

export const SESSION_COOKIE_OPTIONS = {
	httpOnly: true,
	sameSite: "lax" as const,
	path: "/",
};
