import { parseHttpUrl } from "./parse-http-url";

/** Every entry is a verified action-endpoint shape — a URL a GET can act on
 * (unsubscribe, confirm opt-in, change preferences) — never a click-tracking
 * wrapper: ESPs route article links through the same wrapper hosts
 * (cmail*.com/t/, ct.sendgrid.net/ls/click, click.convertkit-mail*.com), so a
 * wrapper-host entry would skip every article in those newsletters. */
const ACTION_PATH_SEGMENTS: ReadonlySet<string> = new Set([
	"unsubscribe",
	"unsubscribe.html",
	"unsub",
	"optout",
	"opt-out",
	"manage-preferences",
	"email-preferences",
]);

const ACTION_PATH_PREFIXES: readonly string[] = [
	"/action/disable_email",
	"/hs/manage-preferences",
	"/hs/preferences-center",
	"/subscribe/confirm",
];

const ACTION_HOSTS: readonly string[] = ["manage.kmail-lists.com"];

const ACTION_HOST_PATHS: readonly { host: string; pathPrefixes: readonly string[] }[] = [
	{ host: "list-manage.com", pathPrefixes: ["/unsubscribe", "/profile"] },
	{ host: "mail.google.com", pathPrefixes: ["/mail"] },
	{ host: "mail-settings.google.com", pathPrefixes: ["/mail"] },
];

/** Segment-bounded so `/subscribe/confirm` claims `/subscribe/confirm/x` but
 * never `/subscribe/confirmation-2024-recap`. */
function startsWithPathPrefix(input: { path: string; prefix: string }): boolean {
	return input.path === input.prefix || input.path.startsWith(`${input.prefix}/`);
}

function matchesHost(input: { hostname: string; host: string }): boolean {
	return input.hostname === input.host || input.hostname.endsWith(`.${input.host}`);
}

export function isKnownNewsletterActionLink(link: { url: string }): boolean {
	const url = parseHttpUrl(link.url);
	if (url === undefined) return false;
	const hostname = url.hostname.replace(/\.$/, "");
	const path = url.pathname.toLowerCase();
	const segments = path.split("/").filter((segment) => segment !== "");
	if (segments.some((segment) => ACTION_PATH_SEGMENTS.has(segment))) return true;
	if (ACTION_PATH_PREFIXES.some((prefix) => startsWithPathPrefix({ path, prefix }))) return true;
	if (ACTION_HOSTS.some((host) => matchesHost({ hostname, host }))) return true;
	return ACTION_HOST_PATHS.some(
		(entry) =>
			matchesHost({ hostname, host: entry.host }) &&
			entry.pathPrefixes.some((prefix) => startsWithPathPrefix({ path, prefix })),
	);
}
