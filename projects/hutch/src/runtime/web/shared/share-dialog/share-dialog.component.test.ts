import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderShareDialog, renderSharePanel } from "./share-dialog.component";

const ARTICLE = {
	shareUrl: "https://readplace.com/view/example.com/post",
	title: "Why readers keep tabs open",
	campaign: "reader-internal",
} as const;

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

function sharedLink(href: string): URL {
	const target = new URL(href);
	const embedded = {
		"wa.me": () => (target.searchParams.get("text") ?? "").split(" ").at(-1),
		"www.facebook.com": () => target.searchParams.get("u"),
		"x.com": () => target.searchParams.get("url"),
		"www.reddit.com": () => target.searchParams.get("url"),
	}[target.hostname];
	assert(embedded, `${target.hostname} is not a share target`);
	return new URL(embedded() ?? "");
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
		expect(described).toEqual(["Copy the link to this article or send it to an app.", ""]);
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

	it("sends the public link to five apps in order, each tagged with the app it went through", () => {
		const doc = parse(renderShareDialog(ARTICLE));

		const targets = Array.from(doc.querySelectorAll("[data-test-share-target]"));
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
		const apps = targets.filter((target) => target.getAttribute("data-test-share-target") !== "email");
		expect(
			apps.map((target) => {
				const shared = sharedLink(target.getAttribute("href") ?? "");
				return [
					`${shared.origin}${shared.pathname}`,
					shared.searchParams.get("utm_source"),
					shared.searchParams.get("utm_medium"),
					shared.searchParams.get("utm_campaign"),
					target.getAttribute("target"),
					target.getAttribute("rel"),
				];
			}),
		).toEqual([
			["https://readplace.com/view/example.com/post", "share-dialog", "whatsapp", "reader-internal", "_blank", "noopener noreferrer"],
			["https://readplace.com/view/example.com/post", "share-dialog", "facebook", "reader-internal", "_blank", "noopener noreferrer"],
			["https://readplace.com/view/example.com/post", "share-dialog", "x", "reader-internal", "_blank", "noopener noreferrer"],
			["https://readplace.com/view/example.com/post", "share-dialog", "reddit", "reader-internal", "_blank", "noopener noreferrer"],
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
			"https://readplace.com/view/example.com/post?utm_source=share-dialog&utm_medium=email&utm_campaign=reader-internal",
		);
		expect(email.hasAttribute("target")).toBe(false);
	});

	it("shows the link tagged as a copy, with Copy hidden until the page knows it can write the clipboard", () => {
		const doc = parse(renderShareDialog(ARTICLE));

		const field = doc.querySelector<HTMLInputElement>("[data-test-share-url]");
		assert(field, "the dialog must show the link");
		expect(field.value).toBe(
			"https://readplace.com/view/example.com/post?utm_source=share-dialog&utm_medium=copy&utm_campaign=reader-internal",
		);
		expect(field.hasAttribute("readonly")).toBe(true);
		const copy = doc.querySelector<HTMLButtonElement>("[data-test-share-copy]");
		assert(copy, "the dialog must carry Copy");
		expect(copy.hidden).toBe(true);
		expect(copy.getAttribute("data-share-url")).toBe(field.value);
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

	it("keeps the campaign it was given on every link", () => {
		const doc = parse(renderShareDialog({ ...ARTICLE, campaign: "reader-public" }));

		const field = doc.querySelector<HTMLInputElement>("[data-test-share-url]");
		assert(field, "the dialog must show the link");
		expect(new URL(field.value).searchParams.get("utm_campaign")).toBe("reader-public");
		const facebook = doc.querySelector('[data-test-share-target="facebook"]');
		assert(facebook, "the dialog must offer Facebook");
		expect(sharedLink(facebook.getAttribute("href") ?? "").searchParams.get("utm_campaign")).toBe("reader-public");
	});
});

describe("renderSharePanel", () => {
	it("renders the link, the five apps and the status line without the founder row or Cancel", () => {
		const panel = parse(renderSharePanel(ARTICLE)).body;

		expect(Array.from(panel.children, (child) => child.className)).toEqual(["share-dialog__panel"]);
		const parts = panel.querySelector(".share-dialog__panel")?.children;
		assert(parts, "the panel must render its parts");
		expect(Array.from(parts, (part) => part.classList.item(part.classList.length - 1))).toEqual([
			"share-dialog__field",
			"share-dialog__targets",
			"sr-only",
		]);
		expect(panel.querySelectorAll("[data-test-share-target]").length).toBe(5);
		expect(panel.querySelector("[data-share-status]")?.getAttribute("role")).toBe("status");
		expect(panel.querySelectorAll("[data-test-share-avatar], [data-test-action='share-cancel']").length).toBe(0);
	});
});
