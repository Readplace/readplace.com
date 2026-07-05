import { SUPPORTED_CLIENTS } from "@packages/supported-clients";

const BROWSER_EXTENSION_NAMES = SUPPORTED_CLIENTS.flatMap((client) =>
	client.group === "browserExtension" ? [client.displayName] : [],
);

export const BROWSER_EXTENSIONS_AND = BROWSER_EXTENSION_NAMES.join(" and ");
export const BROWSER_EXTENSIONS_OR = BROWSER_EXTENSION_NAMES.join(" or ");
export const BROWSER_EXTENSIONS_LISTED = BROWSER_EXTENSION_NAMES.join(", ");
export const BROWSER_EXTENSION_KEYWORDS = BROWSER_EXTENSION_NAMES.map(
	(name) => `${name} extension`,
).join(", ");
