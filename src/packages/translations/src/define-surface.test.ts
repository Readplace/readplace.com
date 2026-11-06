import assert from "node:assert/strict";
import { combineSurfaces, defineSurface, fill, lookupMessage, placeholdersOf, translator } from "./define-surface";
import { DEFAULT_LOCALE } from "./locale";
import type { LocaleOf } from "./message.types";

const sample = defineSurface({
	purpose: "A surface used only by these tests",
	defaultMessages: {
		page: {
			heading: "Your reading list",
			greeting: "Hello, {name}. You have {count} left.",
			articles: { one: "{count} article in {list}", other: "{count} articles in {list}" },
			saved: { one: "One link saved", other: "{count} links saved" },
			blank: "",
		},
	},
	otherLocales: {},
});

describe("defineSurface", () => {
	it("keeps the purpose and the en-US tree", () => {
		assert.equal(sample.purpose, "A surface used only by these tests");
		assert.equal(sample.nonEmpty, false);
		assert.equal(sample.defaultMessages.page.heading, "Your reading list");
	});

	it("refuses a surface with no purpose", () => {
		assert.throws(() => defineSurface({ purpose: " ", defaultMessages: {}, otherLocales: {} }), /must state its purpose/);
	});

	it("refuses a key that holds a dot, since keys are dotted paths", () => {
		const messages = { "page.title": "Title" };
		assert.throws(
			() => defineSurface({ purpose: "Dots", defaultMessages: messages, otherLocales: {} }),
			/"page.title" under "" must be non-empty and contain no dot/,
		);
	});

	it("refuses a leaf that is neither a string nor a tree", () => {
		const messages = { page: { count: 3 } };
		assert.throws(
			// @ts-expect-error -- a number is not a message
			() => defineSurface({ purpose: "Numbers", defaultMessages: messages, otherLocales: {} }),
			/"page.count" must be a string or a nested tree/,
		);
	});

	it("refuses an empty leaf in a surface whose messages may not be empty", () => {
		assert.throws(
			() =>
				defineSurface({
					purpose: "Titles",
					nonEmpty: true,
					// @ts-expect-error -- an empty title is refused at compile time too
					defaultMessages: { action: { save: "" } },
					otherLocales: {},
				}),
			/en-US "action.save" must not be empty/,
		);
		const titles = defineSurface({
			purpose: "Titles",
			nonEmpty: true,
			defaultMessages: { action: { save: "Save" } },
			otherLocales: {},
		});
		assert.equal(titles.nonEmpty, true);
	});

	describe("another locale", () => {
		const defaultMessages = { page: { greeting: "Hello, {name}", title: "Title" } } as const;
		const define = (other: object) =>
			defineSurface({ purpose: "Locales", defaultMessages, otherLocales: { "en-AU": other } });

		it("is kept when it carries every key with the same placeholders", () => {
			const surface = define({ page: { greeting: "G'day, {name}", title: "Title" } });
			assert.equal(lookupMessage(surface.locales["en-AU"], "page.greeting"), "G'day, {name}");
		});

		it("is refused when it misses a key", () => {
			assert.throws(() => define({ page: { greeting: "G'day, {name}" } }), /en-AU "page" must have exactly the keys greeting, title/);
		});

		it("is refused when it adds a key", () => {
			assert.throws(() => define({ page: { greeting: "G'day, {name}", title: "T", extra: "X" } }), /exactly the keys/);
			assert.throws(() => define({ page: { greeting: "G'day, {name}", title: "T" }, more: {} }), /en-AU "\(root\)"/);
		});

		it("is refused when it drops or renames a placeholder", () => {
			assert.throws(() => define({ page: { greeting: "G'day, {nme}", title: "Title" } }), /must use the placeholders \{name\}/);
		});

		it("is refused when a string becomes a tree or a tree a string", () => {
			assert.throws(() => define({ page: { greeting: { one: "a" }, title: "Title" } }), /"page.greeting" must be a string/);
			assert.throws(() => define({ page: "Page" }), /"page" must be a nested tree/);
		});

		it("is refused at compile time when it misses a key, adds one or drops a placeholder", () => {
			type Other = LocaleOf<typeof defaultMessages>;
			// @ts-expect-error -- title is missing
			const missing: Other = { page: { greeting: "G'day, {name}" } };
			// @ts-expect-error -- extra is not an en-US key
			const excess: Other = { page: { greeting: "G'day, {name}", title: "T", extra: "X" } };
			// @ts-expect-error -- {name} is dropped
			const dropped: Other = { page: { greeting: "G'day, mate", title: "T" } };
			const kept: Other = { page: { greeting: "G'day, {name}!", title: "" } };
			assert.ok([missing, excess, dropped, kept]);
		});
	});

	it("refuses a locale that is supported but has no messages", () => {
		const surface = { ...sample, locales: {} };
		assert.throws(() => translator(surface, DEFAULT_LOCALE), /has no messages for en-US/);
	});
});

describe("translator", () => {
	const { t, tPlural } = translator(sample, DEFAULT_LOCALE);

	it("returns a message with no placeholders as written", () => {
		assert.equal(t("page.heading"), "Your reading list");
		assert.equal(t("page.blank"), "");
	});

	it("fills every placeholder", () => {
		assert.equal(t("page.greeting", { name: "Ada", count: 3 }), "Hello, Ada. You have 3 left.");
	});

	it("is checked at compile time", () => {
		// @ts-expect-error -- the key does not exist
		assert.throws(() => t("page.missing"), /No en-US message at "page.missing"/);
		// @ts-expect-error -- {name} is misspelled
		assert.throws(() => t("page.greeting", { nme: "Ada", count: 3 }), /takes the params \{count\}, \{name\}/);
		// @ts-expect-error -- a plural is read with tPlural
		assert.throws(() => t("page.articles"), /No en-US message at "page.articles"/);
	});

	it("picks the plural form with the locale's plural rules", () => {
		assert.equal(tPlural("page.articles", { count: 0, list: "All" }), "0 articles in All");
		assert.equal(tPlural("page.articles", { count: 1, list: "All" }), "1 article in All");
		assert.equal(tPlural("page.articles", { count: 2, list: "All" }), "2 articles in All");
	});

	it("passes a form only the params it uses", () => {
		assert.equal(tPlural("page.saved", { count: 1 }), "One link saved");
		assert.equal(tPlural("page.saved", { count: 4 }), "4 links saved");
	});

	it("refuses a param no form uses and a key that is not a plural", () => {
		// @ts-expect-error -- extra is no form's placeholder
		assert.throws(() => tPlural("page.saved", { count: 1, extra: "x" }), /takes the params \{count\}/);
		// @ts-expect-error -- heading is not a plural
		assert.throws(() => tPlural("page.heading", { count: 1 }), /No en-US plural message at "page.heading"/);
	});

	it("refuses a plural whose forms are not strings or miss the selected form", () => {
		const broken = defineSurface({
			purpose: "Broken plurals",
			defaultMessages: { page: { nested: { one: { deeper: "x" }, other: "y" }, partial: { other: "{count} items" } } },
			otherLocales: {},
		});
		const plural = translator(broken, DEFAULT_LOCALE).tPlural;
		// @ts-expect-error -- nested is not plural-shaped
		assert.throws(() => plural("page.nested", { count: 1 }), /The "one" form at "page.nested" must be a string/);
		// @ts-expect-error -- partial is not plural-shaped
		assert.throws(() => plural("page.partial", { count: 1 }), /No en-US "one" form at "page.partial"/);
	});
});

describe("lookupMessage", () => {
	it("finds nothing below a missing key or below a string", () => {
		const tree = { page: { heading: "Heading" } };
		assert.equal(lookupMessage(tree, "page.heading"), "Heading");
		assert.equal(lookupMessage(tree, "page.missing.deeper"), undefined);
		assert.equal(lookupMessage(tree, "page.heading.deeper"), undefined);
	});
});

describe("fill", () => {
	it("substitutes every occurrence and stringifies numbers", () => {
		assert.equal(fill("{a} and {a} make {b}", { a: "one", b: 2 }), "one and one make 2");
	});

	it("refuses missing and extra params", () => {
		assert.throws(() => fill("{a}", {}), /takes the params \{a\}, got \{\}/);
		assert.throws(() => fill("plain", { a: 1 }), /takes the params \{\}, got \{a\}/);
	});

	it("lists placeholders once each, sorted", () => {
		assert.deepEqual(placeholdersOf("{b} {a} {b}"), ["a", "b"]);
	});
});

describe("combineSurfaces", () => {
	const other = defineSurface({ purpose: "Another", defaultMessages: { footer: { link: "Help" } }, otherLocales: {} });
	const catalog = combineSurfaces({ sample, other });

	it("finds a string message by its dotted key", () => {
		assert.equal(catalog.findMessage({ locale: DEFAULT_LOCALE, key: "footer.link" }), "Help");
		assert.equal(catalog.findMessage({ locale: DEFAULT_LOCALE, key: "page.greeting" }), "Hello, {name}. You have {count} left.");
	});

	it("finds nothing for an unknown namespace, an unknown key or a plural", () => {
		assert.equal(catalog.findMessage({ locale: DEFAULT_LOCALE, key: "nowhere.link" }), undefined);
		assert.equal(catalog.findMessage({ locale: DEFAULT_LOCALE, key: "page.nowhere" }), undefined);
		assert.equal(catalog.findMessage({ locale: DEFAULT_LOCALE, key: "page.articles" }), undefined);
	});

	it("lists every leaf key", () => {
		assert.deepEqual(catalog.keys(), [
			"page.heading",
			"page.greeting",
			"page.articles.one",
			"page.articles.other",
			"page.saved.one",
			"page.saved.other",
			"page.blank",
			"footer.link",
		]);
	});

	it("refuses two surfaces that share a page namespace", () => {
		const clash = defineSurface({ purpose: "Clash", defaultMessages: { footer: { other: "x" } }, otherLocales: {} });
		assert.throws(() => combineSurfaces({ other, clash }), /"footer" is defined by both other and clash/);
	});

	it("refuses a surface with no messages for the locale", () => {
		const empty = combineSurfaces({ other: { ...other, locales: {} } });
		assert.throws(() => empty.findMessage({ locale: DEFAULT_LOCALE, key: "footer.link" }), /other has no messages for en-US/);
	});
});
