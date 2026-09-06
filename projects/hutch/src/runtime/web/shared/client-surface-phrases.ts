import type { AdvertisedClientNameInGroup, ClientGroup } from "@packages/supported-clients";

/**
 * User-facing copy enumerates client GROUPS, not individual clients: a new
 * client in an existing group needs no copy change, while a new group is a
 * compile error in every map below until its phrase is written.
 */
const POSSESSIVE_SURFACES = {
	browserExtension: "your browser",
	nativeApp: "your phone",
	aiAssistant: "your AI assistant",
} satisfies Record<ClientGroup, string>;

export const SAVE_SURFACES_PHRASE = `${POSSESSIVE_SURFACES.browserExtension}, ${POSSESSIVE_SURFACES.nativeApp}, or ${POSSESSIVE_SURFACES.aiAssistant}`;

const SHORT_SURFACES = {
	browserExtension: "your browser",
	nativeApp: "phone",
	aiAssistant: "AI assistant",
} satisfies Record<ClientGroup, string>;

export const SAVE_SURFACES_SHORT_PHRASE = `${SHORT_SURFACES.browserExtension}, ${SHORT_SURFACES.nativeApp}, or ${SHORT_SURFACES.aiAssistant}`;

const SETUP_LOCATIONS = {
	browserExtension: "in your browser",
	nativeApp: "on your phone",
	aiAssistant: "in your AI assistant",
} satisfies Record<ClientGroup, string>;

export const SETUP_SURFACES_PHRASE = `${SETUP_LOCATIONS.browserExtension}, ${SETUP_LOCATIONS.nativeApp}, or ${SETUP_LOCATIONS.aiAssistant}`;

/**
 * What each advertised content-capture client is called when a pitch names the
 * surfaces that save the full rendered page. Keyed per ADVERTISED client, not
 * per group, so a client starting or stopping being advertised is a compile
 * error here until this phrase is re-worded — a group-level noun once let
 * "phone apps" pitch an Android app nobody could install. Url-only clients
 * (MCP) cannot capture a page, which is why they are deliberately absent.
 */
const FULL_PAGE_CAPTURE_NOUNS = {
	firefox: "the browser extension",
	chrome: "the browser extension",
	iphone: "the iPhone app",
} satisfies Record<
	AdvertisedClientNameInGroup<"browserExtension"> | AdvertisedClientNameInGroup<"nativeApp">,
	string
>;

const FULL_PAGE_CAPTURE_UNIQUE = [...new Set(Object.values(FULL_PAGE_CAPTURE_NOUNS))];

export const FULL_PAGE_CAPTURE_PHRASE = FULL_PAGE_CAPTURE_UNIQUE.join(" and ");
