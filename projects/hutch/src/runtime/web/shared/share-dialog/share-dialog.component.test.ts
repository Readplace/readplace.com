import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderShareDialog, renderShareFallbacks, renderSharePanel, renderSharePanelsOob } from "./share-dialog.component";

const ORIGINAL = "https://example.com/post?ref=newsletter&id=7";

const ARTICLE = {
	readerViewUrl: "https://readplace.com/view/example.com/post",
	originalUrl: ORIGINAL,
	title: "Why readers keep tabs open",
	campaign: "reader-internal",
} as const;

const ORIGINAL_ONLY = { ...ARTICLE, readerViewUrl: undefined };

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

function sharedLink(href: string): string {
	const target = new URL(href);
	const embedded = {
		"wa.me": () => (target.searchParams.get("text") ?? "").split(" ").at(-1),
		"www.facebook.com": () => target.searchParams.get("u"),
		"x.com": () => target.searchParams.get("url"),
		"www.reddit.com": () => target.searchParams.get("url"),
	}[target.hostname];
	if (href.startsWith("mailto:?")) return new URLSearchParams(href.slice("mailto:?".length)).get("body") ?? "";
	assert(embedded, `${target.hostname} is not a share target`);
	return embedded() ?? "";
}

function targetsFor(doc: Document, key: string): Element[] {
	return Array.from(doc.querySelectorAll(`[data-test-share-targets="${key}"] [data-test-share-target]`));
}

describe("renderShareDialog", () => {
	it("opens as a titled dialog whose only way out is Cancel", () => {
		const doc = parse(renderShareDialog(ARTICLE));

		const dialog = doc.querySelector('[data-test-confirm-popover="share"]');
		assert(dialog, "the share dialog must render");
		expect(dialog.id).toBe("reader-share");
		expect(dialog.querySelector(".confirm-popover__title")?.textContent).toBe("Share");
		expect(Array.from(dialog.querySelectorAll(".confirm-popover__close"))).toEqual([]);
		const cancel = dialog.querySelector('[data-test-action="share-cancel"]');
		assert(cancel, "the dialog must offer Cancel");
		expect([cancel.getAttribute("popovertarget"), cancel.getAttribute("popovertargetaction")]).toEqual([
			"reader-share",
			"hide",
		]);
	});

	it("describes itself with its spoken lead", () => {
		const doc = parse(renderShareDialog(ARTICLE));

		const dialog = doc.querySelector('[data-test-confirm-popover="share"]');
		assert(dialog, "the share dialog must render");
		const described = (dialog.getAttribute("aria-describedby") ?? "")
			.split(" ")
			.map((id) => doc.getElementById(id)?.textContent);
		expect(described).toEqual(["Copy a link to this article or send it to an app.", ""]);
	});

	it("greets the reader beside the founder's photo", () => {
		const doc = parse(renderShareDialog(ARTICLE));

		const avatar = doc.querySelector("[data-test-share-avatar]");
		assert(avatar, "the founder row must carry the avatar");
		expect(avatar.getAttribute("src")?.endsWith("/fayner-brack.jpg")).toBe(true);
		expect(avatar.getAttribute("alt")).toBe("");
		expect(
			Array.from(doc.querySelectorAll(".share-dialog__greeting, .share-dialog__sub-line"), (line) => line.textContent),
		).toEqual(["Hi, I'm Fayner Brack.", "Thanks for using Readplace."]);
	});

	it("sends the reader view to five apps in order, each tagged with the app it went through", () => {
		const doc = parse(renderShareDialog(ARTICLE));

		const targets = targetsFor(doc, "reader-view");
		expect(targets.map((target) => target.getAttribute("data-test-share-target"))).toEqual([
			"whatsapp",
			"facebook",
			"x",
			"email",
			"reddit",
		]);
		expect(targets.map((target) => target.textContent?.trim())).toEqual([
			"WhatsApp",
			"Facebook",
			"X",
			"Email",
			"Reddit",
		]);
		expect(
			targets.map((target) => {
				const shared = new URL(sharedLink(target.getAttribute("href") ?? ""));
				return [
					`${shared.origin}${shared.pathname}`,
					shared.searchParams.get("utm_source"),
					shared.searchParams.get("utm_medium"),
					shared.searchParams.get("utm_campaign"),
					shared.searchParams.get("utm_content"),
					target.getAttribute("target"),
				];
			}),
		).toEqual([
			["https://readplace.com/view/example.com/post", "share-dialog", "whatsapp", "reader-internal", "reader-view", "_blank"],
			["https://readplace.com/view/example.com/post", "share-dialog", "facebook", "reader-internal", "reader-view", "_blank"],
			["https://readplace.com/view/example.com/post", "share-dialog", "x", "reader-internal", "reader-view", "_blank"],
			["https://readplace.com/view/example.com/post", "share-dialog", "email", "reader-internal", "reader-view", null],
			["https://readplace.com/view/example.com/post", "share-dialog", "reddit", "reader-internal", "reader-view", "_blank"],
		]);
	});

	it("sends the original link to the same five apps exactly as the publisher wrote it", () => {
		const doc = parse(renderShareDialog(ARTICLE));

		const targets = targetsFor(doc, "original");
		expect(
			targets.map((target) => [target.getAttribute("data-test-share-target"), sharedLink(target.getAttribute("href") ?? "")]),
		).toEqual([
			["whatsapp", ORIGINAL],
			["facebook", ORIGINAL],
			["x", ORIGINAL],
			["email", ORIGINAL],
			["reddit", ORIGINAL],
		]);
		expect(targets.map((target) => target.getAttribute("rel"))).toEqual([
			"noopener noreferrer",
			"noopener noreferrer",
			"noopener noreferrer",
			null,
			"noopener noreferrer",
		]);
	});

	it("drafts an email with the title as its subject and the tagged link as its body", () => {
		const doc = parse(renderShareDialog(ARTICLE));

		const email = doc.querySelector('[data-test-share-target="email"]');
		assert(email, "the dialog must offer Email");
		const href = email.getAttribute("href") ?? "";
		expect(href.startsWith("mailto:?")).toBe(true);
		const draft = new URLSearchParams(href.slice("mailto:?".length));
		expect(draft.get("subject")).toBe("Why readers keep tabs open");
		expect(draft.get("body")).toBe(
			"https://readplace.com/view/example.com/post?utm_source=share-dialog&utm_medium=email&utm_campaign=reader-internal&utm_content=reader-view",
		);
		expect(email.hasAttribute("target")).toBe(false);
	});

	it("shows both links in labelled rows, with Copy hidden until the page knows it can write the clipboard", () => {
		const doc = parse(renderShareDialog(ARTICLE));

		const rows = Array.from(doc.querySelectorAll("[data-test-share-link]"), (row) => {
			const field = row.querySelector<HTMLInputElement>("[data-test-share-url]");
			const copy = row.querySelector<HTMLButtonElement>("[data-test-share-copy]");
			assert(field && copy, "each row carries its link and its Copy");
			return {
				label: field.labels?.[0]?.textContent,
				value: field.value,
				readonly: field.hasAttribute("readonly"),
				copies: copy.getAttribute("data-share-url"),
				copyName: copy.textContent,
				copyHidden: copy.hidden,
			};
		});
		expect(rows).toEqual([
			{
				label: "Reader view",
				value: "https://readplace.com/view/example.com/post?utm_source=share-dialog&utm_medium=copy&utm_campaign=reader-internal&utm_content=reader-view",
				readonly: true,
				copies: "https://readplace.com/view/example.com/post?utm_source=share-dialog&utm_medium=copy&utm_campaign=reader-internal&utm_content=reader-view",
				copyName: "Copy reader view link",
				copyHidden: true,
			},
			{
				label: "Original link",
				value: ORIGINAL,
				readonly: true,
				copies: ORIGINAL,
				copyName: "Copy original link",
				copyHidden: true,
			},
		]);
		const copy = doc.querySelector<HTMLButtonElement>("[data-test-share-copy]");
		assert(copy, "the dialog must carry Copy");
		expect(
			Array.from(copy.querySelectorAll<HTMLElement>(".share-dialog__copy-glyph"), (glyph) => [
				glyph.hasAttribute("data-share-copy-idle") ? "idle" : "done",
				glyph.hidden,
			]),
		).toEqual([
			["idle", false],
			["done", true],
		]);
	});

	it("asks which link to send, reader view first", () => {
		const doc = parse(renderShareDialog(ARTICLE));

		const choice = doc.querySelector("fieldset.share-dialog__choice");
		assert(choice, "the dialog must ask which link to send");
		expect(choice.querySelector("legend")?.textContent).toBe("Send to an app");
		expect(
			Array.from(choice.querySelectorAll<HTMLInputElement>("[data-test-share-choice]"), (radio) => [
				radio.value,
				radio.closest("label")?.textContent,
				radio.checked,
			]),
		).toEqual([
			["reader-view", "Reader view", true],
			["original", "Original link", false],
		]);
	});

	it("offers only the original link, with nothing to choose, when there is no reader view to share", () => {
		const doc = parse(renderShareDialog(ORIGINAL_ONLY));

		expect(Array.from(doc.querySelectorAll("[data-test-share-link]"), (row) => row.getAttribute("data-test-share-link"))).toEqual([
			"original",
		]);
		expect(doc.querySelector<HTMLInputElement>("[data-test-share-url]")?.value).toBe(ORIGINAL);
		expect(doc.querySelectorAll("[data-test-share-choice]").length).toBe(0);
		expect(doc.querySelector(".share-dialog__panel--choice")).toBeNull();
		expect(targetsFor(doc, "original").map((target) => sharedLink(target.getAttribute("href") ?? ""))).toEqual([
			ORIGINAL,
			ORIGINAL,
			ORIGINAL,
			ORIGINAL,
			ORIGINAL,
		]);
		expect(doc.querySelectorAll('[data-test-share-targets="reader-view"]').length).toBe(0);
	});

	it("keeps the campaign it was given on every reader-view link", () => {
		const doc = parse(renderShareDialog({ ...ARTICLE, campaign: "reader-public" }));

		const field = doc.querySelector<HTMLInputElement>('[data-test-share-url="reader-view"]');
		assert(field, "the dialog must show the reader view");
		expect(new URL(field.value).searchParams.get("utm_campaign")).toBe("reader-public");
		const facebook = targetsFor(doc, "reader-view").find((target) => target.getAttribute("data-test-share-target") === "facebook");
		assert(facebook, "the dialog must offer Facebook");
		expect(new URL(sharedLink(facebook.getAttribute("href") ?? "")).searchParams.get("utm_campaign")).toBe("reader-public");
	});
});

describe("renderSharePanel", () => {
	it("renders the links, the choice, the apps and the status line without the founder row or Cancel", () => {
		const panel = parse(renderSharePanel(ARTICLE, "toolbar")).body;

		expect(Array.from(panel.children, (child) => child.id)).toEqual(["share-panel-toolbar"]);
		const parts = panel.querySelector(".share-dialog__panel")?.children;
		assert(parts, "the panel must render its parts");
		expect(Array.from(parts, (part) => part.classList.item(part.classList.length - 1))).toEqual([
			"share-dialog__link",
			"share-dialog__link",
			"share-dialog__choice",
			"share-dialog__targets--reader-view",
			"share-dialog__targets--original",
			"sr-only",
		]);
		expect(panel.querySelector("[data-share-status]")?.getAttribute("role")).toBe("status");
		expect(panel.querySelectorAll("[data-test-share-avatar], [data-test-action='share-cancel']").length).toBe(0);
		expect(panel.querySelector("[hx-swap-oob]")).toBeNull();
	});

	it("gives each placement its own field ids and its own choice, so one page can hold all three", () => {
		const fallbacks = renderShareFallbacks(ARTICLE);
		const doc = parse(renderShareDialog(ARTICLE) + fallbacks.toolbar + fallbacks.menu);

		const ids = Array.from(doc.querySelectorAll("[data-test-share-url]"), (field) => field.id);
		expect(new Set(ids).size).toBe(6);
		expect(Array.from(new Set(Array.from(doc.querySelectorAll<HTMLInputElement>("[data-test-share-choice]"), (radio) => radio.name)))).toEqual([
			"share-dialog-send",
			"share-toolbar-send",
			"share-menu-send",
		]);
	});
});

describe("renderSharePanelsOob", () => {
	it("renders each named panel ready to replace the one already on the page", () => {
		const doc = parse(renderSharePanelsOob(ARTICLE, ["dialog", "toolbar"]));

		expect(
			Array.from(doc.querySelectorAll("[data-share-panel]"), (panel) => [panel.id, panel.getAttribute("hx-swap-oob")]),
		).toEqual([
			["share-panel-dialog", "outerHTML"],
			["share-panel-toolbar", "outerHTML"],
		]);
	});
});

describe("renderSharePanel opening focus", () => {
	it("opens on the first Copy, which stays hidden until the script knows the clipboard is writable", () => {
		const targets = Array.from(parse(renderSharePanel(ARTICLE, "dialog")).querySelectorAll("[autofocus]"), (target) => ({
			copy: target.getAttribute("data-test-share-copy"),
			hidden: target.hasAttribute("hidden"),
		}));

		expect(targets).toEqual([{ copy: "reader-view", hidden: true }]);
	});
});
