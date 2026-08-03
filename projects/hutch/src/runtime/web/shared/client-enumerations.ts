import { clientCategoryOfGroup, SUPPORTED_CLIENTS } from "@packages/supported-clients";

const BROWSER_EXTENSION_NAMES = SUPPORTED_CLIENTS.flatMap((client) =>
	client.group === "browserExtension" ? [client.displayName] : [],
);

const CONTENT_CAPTURE_CLIENTS = SUPPORTED_CLIENTS.flatMap((client) =>
	clientCategoryOfGroup(client.group) === "contentCapture" ? [client] : [],
);

/** Names every content-capture client except the visitor's own, so the hero can
 * say what else is available. Derived rather than written per browser because
 * the sentence is a complement set: a literal variant cannot be made to fail
 * when a client is added, it just quietly stops naming it. */
export function contentCaptureTrustLine(exclude: string): string {
	const named = CONTENT_CAPTURE_CLIENTS.filter((client) => client.name !== exclude);
	const prefix = named.length === CONTENT_CAPTURE_CLIENTS.length ? "" : "Also on ";
	return `${prefix}${named.map((client) => client.displayName).join(", ")}, and your AI assistant.`;
}

export const BROWSER_EXTENSIONS_AND = BROWSER_EXTENSION_NAMES.join(" and ");
export const BROWSER_EXTENSIONS_OR = BROWSER_EXTENSION_NAMES.join(" or ");
export const BROWSER_EXTENSIONS_LISTED = BROWSER_EXTENSION_NAMES.join(", ");
export const BROWSER_EXTENSION_KEYWORDS = BROWSER_EXTENSION_NAMES.map(
	(name) => `${name} extension`,
).join(", ");
