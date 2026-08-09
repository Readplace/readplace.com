/// <reference lib="dom" />
import {
	COMMAND_BINDINGS_STORAGE_KEY,
	DEFAULT_SAVE_ALL_SHORTCUT,
	DEFAULT_SAVE_SHORTCUT,
	SAVE_ALL_SHORTCUT_MESSAGE_TYPE,
	SAVE_ALL_TABS_COMMAND,
	commandBindingsFromGetAll,
	matchesShortcut,
	resolveContentShortcuts,
	resolveShortcut,
	shortcutHintSegments,
} from "./command-shortcuts";

function createFakeKeyEvent(
	overrides: Partial<KeyboardEvent>,
): KeyboardEvent {
	const event = {
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		key: "",
		...overrides,
	};
	return event as unknown as KeyboardEvent;
}

function parse(stored: string) {
	return resolveShortcut({ stored, fallback: DEFAULT_SAVE_SHORTCUT });
}

describe("command names the extension and its clients agree on", () => {
	it("keeps the manifest command name, the storage key and the message type stable", () => {
		expect(SAVE_ALL_TABS_COMMAND).toBe("save-all-tabs");
		expect(COMMAND_BINDINGS_STORAGE_KEY).toBe("hutch_command_bindings");
		expect(SAVE_ALL_SHORTCUT_MESSAGE_TYPE).toBe("save-all-shortcut-pressed");
	});

	it("defaults save to the bookmark key and save-all to the same key with Shift", () => {
		expect(DEFAULT_SAVE_SHORTCUT).toEqual({
			primary: true,
			alt: false,
			shift: false,
			key: "d",
		});
		expect(DEFAULT_SAVE_ALL_SHORTCUT).toEqual({
			primary: true,
			alt: false,
			shift: true,
			key: "d",
		});
	});
});

describe("matchesShortcut", () => {
	const matchesSave = matchesShortcut(DEFAULT_SAVE_SHORTCUT);
	const matchesSaveAll = matchesShortcut(DEFAULT_SAVE_ALL_SHORTCUT);

	it("accepts Cmd as the primary modifier", () => {
		expect(matchesSave(createFakeKeyEvent({ metaKey: true, key: "d" }))).toBe(
			true,
		);
	});

	it("accepts Ctrl as the primary modifier, so mac Firefox's ⌘ binding still matches", () => {
		expect(matchesSave(createFakeKeyEvent({ ctrlKey: true, key: "d" }))).toBe(
			true,
		);
	});

	it("rejects the bare key with no modifier", () => {
		expect(matchesSave(createFakeKeyEvent({ key: "d" }))).toBe(false);
	});

	it("rejects a different key under the same modifier", () => {
		expect(matchesSave(createFakeKeyEvent({ metaKey: true, key: "e" }))).toBe(
			false,
		);
	});

	it("keeps save and save-all disjoint: Shift is compared exactly", () => {
		const shiftedD = createFakeKeyEvent({
			metaKey: true,
			shiftKey: true,
			key: "D",
		});
		expect(matchesSave(shiftedD)).toBe(false);
		expect(matchesSaveAll(shiftedD)).toBe(true);
	});

	it("matches the uppercase key the browser reports while Shift is held", () => {
		expect(
			matchesSaveAll(
				createFakeKeyEvent({ ctrlKey: true, shiftKey: true, key: "D" }),
			),
		).toBe(true);
	});

	it("compares Alt exactly, so Alt+Cmd+D is not the save shortcut", () => {
		expect(
			matchesSave(createFakeKeyEvent({ metaKey: true, altKey: true, key: "d" })),
		).toBe(false);
	});

	it("rejects a modifier the user did not bind", () => {
		const matchesBareComma = matchesShortcut({
			primary: false,
			alt: false,
			shift: false,
			key: ",",
		});
		expect(matchesBareComma(createFakeKeyEvent({ key: "," }))).toBe(true);
		expect(
			matchesBareComma(createFakeKeyEvent({ ctrlKey: true, key: "," })),
		).toBe(false);
	});
});

describe("resolveShortcut reading a manifest-token binding", () => {
	it("reads the Windows and Linux Chrome format", () => {
		expect(parse("Ctrl+Shift+D")).toEqual({
			primary: true,
			alt: false,
			shift: true,
			key: "d",
		});
	});

	it("reads the mac manifest token Chrome never rewrites for Firefox", () => {
		expect(parse("Command+Shift+D")).toEqual({
			primary: true,
			alt: false,
			shift: true,
			key: "d",
		});
	});

	it("reads MacCtrl as a primary modifier, since the matcher can't tell Ctrl from Meta", () => {
		expect(parse("MacCtrl+K")).toEqual({
			primary: true,
			alt: false,
			shift: false,
			key: "k",
		});
	});

	it("reads Alt-only bindings", () => {
		expect(parse("Alt+Comma")).toEqual({
			primary: false,
			alt: true,
			shift: false,
			key: ",",
		});
	});

	it("maps the named punctuation keys onto their KeyboardEvent values", () => {
		expect(parse("Ctrl+Period")?.key).toBe(".");
		expect(parse("Ctrl+Space")?.key).toBe(" ");
	});

	it("maps the arrow key names onto their KeyboardEvent values", () => {
		expect(parse("Ctrl+Up")?.key).toBe("ArrowUp");
		expect(parse("Ctrl+Down")?.key).toBe("ArrowDown");
		expect(parse("Ctrl+Left")?.key).toBe("ArrowLeft");
		expect(parse("Ctrl+Right")?.key).toBe("ArrowRight");
	});

	it("maps the navigation key names onto their KeyboardEvent values", () => {
		expect(parse("Ctrl+Home")?.key).toBe("Home");
		expect(parse("Ctrl+End")?.key).toBe("End");
		expect(parse("Ctrl+PageUp")?.key).toBe("PageUp");
		expect(parse("Ctrl+PageDown")?.key).toBe("PageDown");
		expect(parse("Ctrl+Insert")?.key).toBe("Insert");
		expect(parse("Ctrl+Delete")?.key).toBe("Delete");
	});

	it("reads digit and function keys", () => {
		expect(parse("Ctrl+7")?.key).toBe("7");
		expect(parse("Ctrl+F5")?.key).toBe("F5");
		expect(parse("Ctrl+F12")?.key).toBe("F12");
	});
});

describe("resolveShortcut reading a mac Chrome glyph binding", () => {
	it("reads the glyph order Chrome prints", () => {
		expect(parse("⇧⌘D")).toEqual({
			primary: true,
			alt: false,
			shift: true,
			key: "d",
		});
	});

	it("reads the glyphs in any order, so the wire order is not part of the contract", () => {
		expect(parse("⌘⇧D")).toEqual(parse("⇧⌘D"));
	});

	it("reads the Control and Option glyphs", () => {
		expect(parse("⌃⌥K")).toEqual({
			primary: true,
			alt: true,
			shift: false,
			key: "k",
		});
	});

	it("reads a glyph binding onto a named key", () => {
		expect(parse("⌘Comma")?.key).toBe(",");
	});
});

describe("resolveShortcut on a binding it cannot arm", () => {
	it("falls back to the extension default when the command is unassigned", () => {
		expect(parse("")).toEqual(DEFAULT_SAVE_SHORTCUT);
		expect(
			resolveShortcut({ stored: "", fallback: DEFAULT_SAVE_ALL_SHORTCUT }),
		).toEqual(DEFAULT_SAVE_ALL_SHORTCUT);
	});

	it("disarms rather than re-stealing the default when the user bound a media key", () => {
		expect(parse("MediaPlayPause")).toBeNull();
	});

	it("disarms on a key name it has no KeyboardEvent value for", () => {
		expect(parse("Ctrl+Nonsense")).toBeNull();
		expect(parse("Ctrl+F13")).toBeNull();
	});

	it("disarms on a binding that is modifiers only", () => {
		expect(parse("Ctrl+Shift")).toBeNull();
		expect(parse("⇧⌘")).toBeNull();
	});

	it("disarms on a trailing separator", () => {
		expect(parse("Ctrl+")).toBeNull();
	});
});

describe("commandBindingsFromGetAll", () => {
	it("reads the Chrome MV3 action command as the save binding", () => {
		expect(
			commandBindingsFromGetAll([
				{ name: "_execute_action", shortcut: "Ctrl+D" },
				{ name: SAVE_ALL_TABS_COMMAND, shortcut: "Ctrl+Shift+D" },
			]),
		).toEqual({ save: "Ctrl+D", saveAll: "Ctrl+Shift+D" });
	});

	it("reads the Firefox MV2 browser-action command as the same save binding", () => {
		expect(
			commandBindingsFromGetAll([
				{ name: "_execute_browser_action", shortcut: "Ctrl+D" },
			]),
		).toEqual({ save: "Ctrl+D", saveAll: "" });
	});

	it("reports an unassigned command as an empty binding", () => {
		expect(
			commandBindingsFromGetAll([
				{ name: "_execute_action", shortcut: "" },
				{ name: SAVE_ALL_TABS_COMMAND, shortcut: "" },
			]),
		).toEqual({ save: "", saveAll: "" });
	});

	it("reports a command whose shortcut field is absent as an empty binding", () => {
		expect(
			commandBindingsFromGetAll([{ name: SAVE_ALL_TABS_COMMAND }]),
		).toEqual({ save: "", saveAll: "" });
	});

	it("reports a command Chrome omits entirely as an empty binding", () => {
		expect(commandBindingsFromGetAll([])).toEqual({ save: "", saveAll: "" });
	});

	it("ignores a command it does not own", () => {
		expect(
			commandBindingsFromGetAll([
				{ name: "some-other-command", shortcut: "Ctrl+J" },
				{ shortcut: "Ctrl+K" },
			]),
		).toEqual({ save: "", saveAll: "" });
	});
});

describe("resolveContentShortcuts", () => {
	it("arms both defaults before the background has persisted any binding", () => {
		expect(
			resolveContentShortcuts({
				storedBindings: undefined,
				storedCapabilities: undefined,
			}),
		).toEqual({
			save: DEFAULT_SAVE_SHORTCUT,
			saveAll: DEFAULT_SAVE_ALL_SHORTCUT,
		});
	});

	it("arms both defaults when the stored bindings are not the shape it wrote", () => {
		expect(
			resolveContentShortcuts({
				storedBindings: { save: 7 },
				storedCapabilities: null,
			}),
		).toEqual({
			save: DEFAULT_SAVE_SHORTCUT,
			saveAll: DEFAULT_SAVE_ALL_SHORTCUT,
		});
	});

	it("arms what the user actually bound", () => {
		expect(
			resolveContentShortcuts({
				storedBindings: { save: "Alt+S", saveAll: "Alt+Shift+S" },
				storedCapabilities: ["save-article", "save-articles"],
			}),
		).toEqual({
			save: { primary: false, alt: true, shift: false, key: "s" },
			saveAll: { primary: false, alt: true, shift: true, key: "s" },
		});
	});

	it("disarms save-all against a server that advertises no bulk save, so the browser keeps the key", () => {
		expect(
			resolveContentShortcuts({
				storedBindings: { save: "", saveAll: "" },
				storedCapabilities: ["save-article"],
			}),
		).toEqual({ save: DEFAULT_SAVE_SHORTCUT, saveAll: null });
	});

	it("arms save-all as soon as the server advertises bulk save", () => {
		expect(
			resolveContentShortcuts({
				storedBindings: { save: "", saveAll: "" },
				storedCapabilities: ["save-article", "save-articles"],
			}).saveAll,
		).toEqual(DEFAULT_SAVE_ALL_SHORTCUT);
	});

	it("disarms save-all independently of save when only its own binding is unparseable", () => {
		expect(
			resolveContentShortcuts({
				storedBindings: { save: "Ctrl+D", saveAll: "MediaStop" },
				storedCapabilities: null,
			}),
		).toEqual({ save: DEFAULT_SAVE_SHORTCUT, saveAll: null });
	});
});

describe("shortcutHintSegments", () => {
	it("names the modifiers on Windows and Linux", () => {
		expect(
			shortcutHintSegments({
				stored: "",
				fallback: DEFAULT_SAVE_ALL_SHORTCUT,
				mac: false,
			}),
		).toEqual(["Ctrl", "Shift", "D"]);
	});

	it("draws the modifiers as glyphs on macOS, whatever the wire format was", () => {
		expect(
			shortcutHintSegments({
				stored: "Ctrl+Shift+D",
				fallback: DEFAULT_SAVE_SHORTCUT,
				mac: true,
			}),
		).toEqual(["⌘", "⇧", "D"]);
	});

	it("draws every modifier the binding carries", () => {
		expect(
			shortcutHintSegments({
				stored: "Ctrl+Alt+Shift+K",
				fallback: DEFAULT_SAVE_SHORTCUT,
				mac: false,
			}),
		).toEqual(["Ctrl", "Alt", "Shift", "K"]);
		expect(
			shortcutHintSegments({
				stored: "⌃⌥⇧K",
				fallback: DEFAULT_SAVE_SHORTCUT,
				mac: true,
			}),
		).toEqual(["⌘", "⌥", "⇧", "K"]);
	});

	it("shows an unmodified binding as the key alone", () => {
		expect(
			shortcutHintSegments({
				stored: "F5",
				fallback: DEFAULT_SAVE_SHORTCUT,
				mac: false,
			}),
		).toEqual(["F5"]);
	});

	it("shows a punctuation key as itself rather than its manifest name", () => {
		expect(
			shortcutHintSegments({
				stored: "Ctrl+Comma",
				fallback: DEFAULT_SAVE_SHORTCUT,
				mac: false,
			}),
		).toEqual(["Ctrl", ","]);
	});

	it("falls back to the raw binding when it cannot be read, so the hint still names the user's key", () => {
		expect(
			shortcutHintSegments({
				stored: "Ctrl+MediaPlayPause",
				fallback: DEFAULT_SAVE_SHORTCUT,
				mac: false,
			}),
		).toEqual(["Ctrl", "MediaPlayPause"]);
	});
});
