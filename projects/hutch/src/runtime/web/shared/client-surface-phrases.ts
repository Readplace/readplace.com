import type { ClientGroup } from "@packages/supported-clients";

/**
 * User-facing copy enumerates client GROUPS, not individual clients: a new
 * client in an existing group needs no copy change, while a new group is a
 * compile error in every map below until its phrase is written.
 */
const POSSESSIVE_SURFACES = {
	browserExtension: "your browser",
	nativeApp: "your iPhone",
	aiAssistant: "your AI assistant",
} satisfies Record<ClientGroup, string>;

export const SAVE_SURFACES_PHRASE = `${POSSESSIVE_SURFACES.browserExtension}, ${POSSESSIVE_SURFACES.nativeApp}, or ${POSSESSIVE_SURFACES.aiAssistant}`;

const SHORT_SURFACES = {
	browserExtension: "your browser",
	nativeApp: "iPhone",
	aiAssistant: "AI assistant",
} satisfies Record<ClientGroup, string>;

export const SAVE_SURFACES_SHORT_PHRASE = `${SHORT_SURFACES.browserExtension}, ${SHORT_SURFACES.nativeApp}, or ${SHORT_SURFACES.aiAssistant}`;

const SETUP_LOCATIONS = {
	browserExtension: "in your browser",
	nativeApp: "on your iPhone",
	aiAssistant: "in your AI assistant",
} satisfies Record<ClientGroup, string>;

export const SETUP_SURFACES_PHRASE = `${SETUP_LOCATIONS.browserExtension}, ${SETUP_LOCATIONS.nativeApp}, or ${SETUP_LOCATIONS.aiAssistant}`;

const SAVE_FALLBACK_SURFACES = {
	browserExtension: "the browser extension",
	nativeApp: "your iPhone",
	aiAssistant: "your AI assistant",
} satisfies Record<ClientGroup, string>;

export const SAVE_FALLBACK_PHRASE = `${SAVE_FALLBACK_SURFACES.browserExtension}, ${SAVE_FALLBACK_SURFACES.nativeApp}, or ${SAVE_FALLBACK_SURFACES.aiAssistant}`;

const FULL_PAGE_CAPTURE_SURFACES = {
	browserExtension: "the browser extension",
	nativeApp: "iPhone app",
} satisfies Record<Exclude<ClientGroup, "aiAssistant">, string>;

export const FULL_PAGE_CAPTURE_PHRASE = `${FULL_PAGE_CAPTURE_SURFACES.browserExtension} and ${FULL_PAGE_CAPTURE_SURFACES.nativeApp}`;
