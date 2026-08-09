/// <reference lib="dom" />
import "./zod-config";
import { z } from "zod";
import { advertisesBulkSave } from "./advertised-capabilities";
import { parseStoredCapabilities } from "./sync-context-menus";

export const SAVE_ALL_TABS_COMMAND = "save-all-tabs";
export const SAVE_ALL_SHORTCUT_MESSAGE_TYPE = "save-all-shortcut-pressed";
export const COMMAND_BINDINGS_STORAGE_KEY = "hutch_command_bindings";

/** `primary` is satisfied by either Ctrl or Meta: mac Firefox reports a ⌘
 * binding as "Ctrl", so the two can't be told apart from the wire string. */
export interface CommandShortcut {
	primary: boolean;
	alt: boolean;
	shift: boolean;
	key: string;
}

export interface CommandBindings {
	save: string;
	saveAll: string;
}

export interface ContentShortcuts {
	save: CommandShortcut | null;
	saveAll: CommandShortcut | null;
}

export const DEFAULT_SAVE_SHORTCUT: CommandShortcut = {
	primary: true,
	alt: false,
	shift: false,
	key: "d",
};

export const DEFAULT_SAVE_ALL_SHORTCUT: CommandShortcut = {
	primary: true,
	alt: false,
	shift: true,
	key: "d",
};

type Modifier = "primary" | "alt" | "shift";

const MODIFIER_BY_TOKEN = new Map<string, Modifier>([
	["ctrl", "primary"],
	["command", "primary"],
	["macctrl", "primary"],
	["alt", "alt"],
	["shift", "shift"],
	["⌘", "primary"],
	["⌃", "primary"],
	["⌥", "alt"],
	["⇧", "shift"],
]);

const KEY_BY_TOKEN = new Map<string, string>([
	["comma", ","],
	["period", "."],
	["space", " "],
	["up", "ArrowUp"],
	["down", "ArrowDown"],
	["left", "ArrowLeft"],
	["right", "ArrowRight"],
	["home", "Home"],
	["end", "End"],
	["pageup", "PageUp"],
	["pagedown", "PageDown"],
	["insert", "Insert"],
	["delete", "Delete"],
]);

const MAC_MODIFIER_LABELS: Record<Modifier, string> = {
	primary: "⌘",
	alt: "⌥",
	shift: "⇧",
};

const MODIFIER_LABELS: Record<Modifier, string> = {
	primary: "Ctrl",
	alt: "Alt",
	shift: "Shift",
};

const BINDING_FIELD_BY_COMMAND = new Map<string, keyof CommandBindings>([
	["_execute_action", "save"],
	["_execute_browser_action", "save"],
	[SAVE_ALL_TABS_COMMAND, "saveAll"],
]);

const EMPTY_BINDINGS: CommandBindings = { save: "", saveAll: "" };

const StoredCommandBindingsSchema = z.object({
	save: z.string(),
	saveAll: z.string(),
});

/** Chrome on macOS reports a binding as separator-free glyphs ("⇧⌘D"); every
 * other platform and browser reports manifest tokens ("Ctrl+Shift+D"). A
 * modifier glyph anywhere in the string is what tells the two apart. */
function splitShortcut(shortcut: string): string[] {
	const glyphs: string[] = [];
	let remainder = "";
	for (const char of shortcut) {
		if (MODIFIER_BY_TOKEN.has(char)) {
			glyphs.push(char);
			continue;
		}
		remainder += char;
	}
	if (glyphs.length === 0) return shortcut.split("+");
	if (remainder !== "") glyphs.push(remainder);
	return glyphs;
}

function normalizeKey(token: string): string | null {
	const named = KEY_BY_TOKEN.get(token.toLowerCase());
	if (named !== undefined) return named;
	if (/^[a-z]$/i.test(token)) return token.toLowerCase();
	if (/^[0-9]$/.test(token)) return token;
	if (/^f([1-9]|1[0-2])$/i.test(token)) return token.toUpperCase();
	return null;
}

function parseCommandShortcut(shortcut: string): CommandShortcut | null {
	const modifiers: Record<Modifier, boolean> = {
		primary: false,
		alt: false,
		shift: false,
	};
	let key = "";
	for (const token of splitShortcut(shortcut)) {
		const modifier = MODIFIER_BY_TOKEN.get(token.toLowerCase());
		if (modifier !== undefined) {
			modifiers[modifier] = true;
			continue;
		}
		const normalized = normalizeKey(token);
		if (normalized === null) return null;
		key = normalized;
	}
	if (key === "") return null;
	return { ...modifiers, key };
}

export function matchesShortcut(
	shortcut: CommandShortcut,
): (event: KeyboardEvent) => boolean {
	return (event) =>
		(event.metaKey || event.ctrlKey) === shortcut.primary &&
		event.altKey === shortcut.alt &&
		event.shiftKey === shortcut.shift &&
		event.key.toLowerCase() === shortcut.key.toLowerCase();
}

function shortcutDisplaySegments(input: {
	shortcut: CommandShortcut;
	mac: boolean;
}): string[] {
	const labels = input.mac ? MAC_MODIFIER_LABELS : MODIFIER_LABELS;
	const segments: string[] = [];
	if (input.shortcut.primary) segments.push(labels.primary);
	if (input.shortcut.alt) segments.push(labels.alt);
	if (input.shortcut.shift) segments.push(labels.shift);
	const { key } = input.shortcut;
	segments.push(key.length === 1 ? key.toUpperCase() : key);
	return segments;
}

export function commandBindingsFromGetAll(
	commands: readonly { name?: string; shortcut?: string }[],
): CommandBindings {
	const bindings: CommandBindings = { ...EMPTY_BINDINGS };
	for (const command of commands) {
		const field = BINDING_FIELD_BY_COMMAND.get(command.name ?? "");
		if (field === undefined) continue;
		bindings[field] = command.shortcut ?? "";
	}
	return bindings;
}

function parseStoredCommandBindings(raw: unknown): CommandBindings | null {
	const stored = StoredCommandBindingsSchema.safeParse(raw);
	if (!stored.success) return null;
	return stored.data;
}

/** An empty binding is the browser's own "unassigned" answer — the state Chrome
 * ships in, because it silently refuses to auto-assign a suggested key it already
 * owns — so the extension's own default takes over. A binding that is present but
 * unparseable belongs to a user who deliberately rebound: the native command
 * delivers it, and re-arming the old default would keep stealing the key they
 * moved away from. */
export function resolveShortcut(input: {
	stored: string;
	fallback: CommandShortcut;
}): CommandShortcut | null {
	if (input.stored === "") return input.fallback;
	return parseCommandShortcut(input.stored);
}

export function resolveContentShortcuts(input: {
	storedBindings: unknown;
	storedCapabilities: unknown;
}): ContentShortcuts {
	const parsed = parseStoredCommandBindings(input.storedBindings);
	const bindings = parsed === null ? EMPTY_BINDINGS : parsed;
	const bulkSave = advertisesBulkSave(
		parseStoredCapabilities(input.storedCapabilities),
	);
	return {
		save: resolveShortcut({
			stored: bindings.save,
			fallback: DEFAULT_SAVE_SHORTCUT,
		}),
		saveAll: bulkSave
			? resolveShortcut({
					stored: bindings.saveAll,
					fallback: DEFAULT_SAVE_ALL_SHORTCUT,
				})
			: null,
	};
}

export function shortcutHintSegments(input: {
	stored: string;
	fallback: CommandShortcut;
	mac: boolean;
}): string[] {
	const resolved = resolveShortcut({
		stored: input.stored,
		fallback: input.fallback,
	});
	if (resolved === null) return input.stored.split("+");
	return shortcutDisplaySegments({ shortcut: resolved, mac: input.mac });
}
