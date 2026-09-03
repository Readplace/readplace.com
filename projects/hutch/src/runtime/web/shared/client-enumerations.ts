import { ADVERTISED_CLIENTS } from "@packages/supported-clients";
import type { AdvertisedClientNameInGroup } from "@packages/supported-clients";

const BROWSER_EXTENSION_NAMES = ADVERTISED_CLIENTS.flatMap((client) =>
	client.group === "browserExtension" ? [client.displayName] : [],
);

export const BROWSER_EXTENSIONS_AND = BROWSER_EXTENSION_NAMES.join(" and ");
export const BROWSER_EXTENSIONS_OR = BROWSER_EXTENSION_NAMES.join(" or ");
export const BROWSER_EXTENSIONS_LISTED = BROWSER_EXTENSION_NAMES.join(", ");
export const BROWSER_EXTENSION_KEYWORDS = BROWSER_EXTENSION_NAMES.map(
	(name) => `${name} extension`,
).join(", ");

const AI_ASSISTANT_NAMES = ADVERTISED_CLIENTS.flatMap((client) =>
	client.group === "aiAssistant" ? [client.displayName] : [],
);

export const AI_ASSISTANTS_LISTED = AI_ASSISTANT_NAMES.join(", ");
export const AI_ASSISTANT_SAVE_KEYWORDS = AI_ASSISTANT_NAMES.map(
	(name) => `save from ${name}`,
).join(", ");

export function orPhrase(names: readonly string[]): string {
	if (names.length === 1) return names[0];
	return `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`;
}

/** "A, B, or C" — the assistants a reader can connect today, named from the
 * roster so a new one reaches every sentence without an edit there. */
export const AI_ASSISTANTS_OR = orPhrase(AI_ASSISTANT_NAMES);

/** How the no-client card names each advertised phone app as a device the
 * visitor might also own, article included, so the sentence cannot pitch a
 * phone whose app nobody can install. */
const NATIVE_APP_DEVICES = {
	iphone: "an iPhone",
} satisfies Record<AdvertisedClientNameInGroup<"nativeApp">, string>;

export const NATIVE_APP_DEVICES_OR = Object.values(NATIVE_APP_DEVICES).join(" or ");
