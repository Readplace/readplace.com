import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	MinutesSchema,
	ReaderArticleHashIdSchema,
	SaveableUrlSchema,
} from "@packages/domain/article";
import type { SavedArticle } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { generateCspNonce } from "@packages/web-shell";
import { toAbsoluteDate, toAbsoluteTime } from "@packages/web-shell/local-time.format";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { destinationUrl, siteLabel } from "../../test-helpers/article-fixtures";
import { Base } from "../../base.component";
import { ReaderPage } from "./reader.component";
import { READER_STYLES } from "./reader.styles";
import { SHARE_DIALOG_STYLES } from "../../shared/share-dialog/share-dialog.styles";
import { SHARE_BALLOON_STYLES } from "../../shared/share-balloon/share-balloon.styles";
import { READLIST_NAME_FORM_STYLES } from "../readlist/readlist-name-form.styles";
import { EXIT_CONFIRM_SCOPE } from "./reader-exit-confirm.component";
import {
	ChromelessReader,
	type RenderReaderActions,
	WebReader,
} from "../../shared/article-body/reader-actions/reader-actions.component";
import type { ReaderReadlistFiling } from "../readlist/reader-readlist-filing";
import type { ArticleVersion } from "../../shared/article-reader/article-reader.types";

const NO_QUEUE_FILING: ReaderReadlistFiling = {
	tags: undefined,
	picker: undefined,
	markStatusConfirmReadlists: undefined,
	toast: undefined,
};

const PICKER = {
	assignUrl: "/queue/abc/assign?utm_source=reader-readlists&utm_medium=internal&utm_content=assign",
	returnTo: "/queue/abc/view",
	options: [{ slug: ReadlistSlugSchema.parse("work"), label: "Work", iconName: "folder" as const }],
	create: {
		createUrl: "/queue/abc/create-and-assign?utm_source=reader-readlists&utm_medium=internal&utm_content=create-and-assign",
		maxLength: 24,
		popoverId: "reader-readlist-create",
		nameLabel: "Readlist name",
		namePlaceholder: "Enter readlist name",
	},
};

const userId = UserIdSchema.parse("00000000000000000000000000000001");
const articleId = ReaderArticleHashIdSchema.parse(
	"0123456789abcdef0123456789abcdef",
);
const url = SaveableUrlSchema.parse("https://example.com/post");

function makeArticle(overrides: Partial<SavedArticle> = {}): SavedArticle {
	return {
		id: articleId,
		userId,
		url,
		destinationUrl: destinationUrl(url),
		metadata: {
			title: "Hello World",
			siteName: siteLabel("example.com"),
			excerpt: "A lovely article.",
			wordCount: 500,
		},
		content: "<p>Body copy.</p>",
		estimatedReadTime: MinutesSchema.parse(3),
		status: "unread",
		savedAt: new Date(),
		...overrides,
	};
}

const DEFAULT_APP_ORIGIN = "http://localhost:3000";
const TEST_BACK_LINK = {
	topHref: "/queue?back=top",
	label: "Back to readlist",
};
const NOW = new Date("2026-08-05T12:00:00.000Z");
const CSP_NONCE = generateCspNonce();
const TEST_CURRENT_PATH = "/queue/abc/view";
const TEST_READER_PATH = (id: string) => `/queue/${id}/view`;

function renderReaderDocument(
	renderActions: RenderReaderActions,
	readlistFiling: ReaderReadlistFiling = NO_QUEUE_FILING,
): Document {
	const html = Base(
		ReaderPage(makeArticle(), { appOrigin: DEFAULT_APP_ORIGIN, backLink: TEST_BACK_LINK, renderActions, readlistFiling, provenance: undefined, now: NOW, currentPath: TEST_CURRENT_PATH, readerPathFor: TEST_READER_PATH }),
		{ isAuthenticated: true, emailVerified: undefined, cspNonce: CSP_NONCE },
	).to("text/html").body;
	return new JSDOM(html).window.document;
}

function versionAt(iso: string): ArticleVersion {
	return { minuteId: iso, date: toAbsoluteDate({ iso }), time: toAbsoluteTime({ iso }) };
}

function renderRail(options: Partial<Parameters<typeof ReaderPage>[1]>): Element {
	const html = Base(
		ReaderPage(makeArticle(), {
			appOrigin: DEFAULT_APP_ORIGIN,
			backLink: TEST_BACK_LINK,
			renderActions: WebReader,
			readlistFiling: NO_QUEUE_FILING,
			provenance: undefined,
			now: NOW,
			currentPath: TEST_CURRENT_PATH,
			readerPathFor: TEST_READER_PATH,
			...options,
		}),
		{ isAuthenticated: true, emailVerified: undefined, cspNonce: CSP_NONCE },
	).to("text/html").body;
	const rail = new JSDOM(html).window.document.querySelector(".reading-layout > [data-test-reader-rail]");
	assert(rail, "the reader must render its rail beside the main track");
	return rail;
}

function railLandmark(rail: Element): { tag: string; label: string | null } {
	return { tag: rail.tagName, label: rail.getAttribute("aria-label") };
}

function railChildTags(rail: Element): string[] {
	return Array.from(rail.children, (child) => child.tagName);
}

const READER_PATH_FOR_READLIST = (id: string) => `/queue/${id}/view`;

const READY_PAST_READS = {
	status: "ready" as const,
	items: [
		{
			id: ReaderArticleHashIdSchema.parse("fedcba9876543210fedcba9876543210"),
			title: "An earlier read on the subject",
			siteName: siteLabel("Example"),
			reason: "Same subject",
		},
	],
};

describe("ReaderPage", () => {
	it("names the rail Article details and lists the versions in it, outside the article column, ahead of the Top link", () => {
		const rail = renderRail({
			crawlVersions: [versionAt("2026-07-10T09:14Z"), versionAt("2026-06-28T22:01Z")],
		});

		expect(railLandmark(rail)).toEqual({ tag: "ASIDE", label: "Article details" });
		expect(railChildTags(rail)).toEqual(["DETAILS", "A"]);
		const card = rail.querySelector(":scope > details[data-test-article-history]");
		assert(card, "Article history must be the rail's own child");
		expect(
			Array.from(card.querySelectorAll("[data-test-article-history-version]"), (row) =>
				row.getAttribute("data-test-article-history-version"),
			),
		).toEqual(["canonical", "2026-06-28T22:01Z"]);
		expect(rail.ownerDocument.querySelectorAll("[data-article-body] [data-test-article-history]")).toHaveLength(0);
		expect(rail.lastElementChild?.hasAttribute("data-test-reader-top")).toBe(true);
	});

	it("names the rail Article details when past reads has a card to show and the article has no version", () => {
		const rail = renderRail({
			crawlVersions: [],
			readerPathForReadlist: READER_PATH_FOR_READLIST,
			previouslyRead: READY_PAST_READS,
		});

		expect(railLandmark(rail)).toEqual({ tag: "ASIDE", label: "Article details" });
		expect(railChildTags(rail)).toEqual(["SECTION", "A"]);
		expect(rail.querySelectorAll(":scope > [data-test-reader-topic-reads] details.past-reads__card")).toHaveLength(1);
	});

	it("leaves the rail an unnamed div while it has no card to show: no version, and past reads still pending", () => {
		const rail = renderRail({
			crawlVersions: [],
			readerPathForReadlist: READER_PATH_FOR_READLIST,
			previouslyRead: { status: "pending" },
			previouslyReadPollUrl: "/queue/abc/topic-reads?poll=1",
			previouslyReadComputeUrl: "/queue/abc/topic-reads",
		});

		expect(railLandmark(rail)).toEqual({ tag: "DIV", label: null });
		expect(railChildTags(rail)).toEqual(["SECTION", "NOSCRIPT", "A"]);
	});

	it("stacks Article history, the stored copy's template and past reads in the rail when the page reads offline", () => {
		const cards = {
			crawlVersions: [versionAt("2026-07-10T09:14Z")],
			readerPathForReadlist: READER_PATH_FOR_READLIST,
			previouslyRead: READY_PAST_READS,
		};

		const offline = renderRail({ ...cards, offlineCopyRow: true });
		const online = renderRail(cards);

		expect(railChildTags(offline)).toEqual(["DETAILS", "TEMPLATE", "SECTION", "A"]);
		expect(offline.querySelector(":scope > template")?.hasAttribute("data-offline-copy-template")).toBe(true);
		expect(railChildTags(online)).toEqual(["DETAILS", "SECTION", "A"]);
	});

	it("hands the owner's removal controls to the version they authored", () => {
		const rail = renderRail({
			crawlVersions: [versionAt("2026-07-10T09:14Z")],
			articleHistoryRemoval: {
				authoredMinuteIds: ["2026-07-10T09:14Z"],
				removeVersionUrl: "/queue/abc/remove-my-version",
			},
		});

		expect(
			Array.from(rail.querySelectorAll("form[data-test-article-history-remove]"), (form) => form.getAttribute("action")),
		).toEqual(["/queue/abc/remove-my-version"]);
	});

	it("renders the previously-read section when the owner reader supplies its reading-list link builder", () => {
		const html = Base(
			ReaderPage(makeArticle(), {
				appOrigin: DEFAULT_APP_ORIGIN,
				backLink: TEST_BACK_LINK,
				renderActions: WebReader,
				readlistFiling: NO_QUEUE_FILING,
				provenance: undefined,
				now: NOW,
				currentPath: TEST_CURRENT_PATH,
				readerPathFor: TEST_READER_PATH,
				readerPathForReadlist: (id: string) => `/queue/${id}/view`,
				previouslyRead: { status: "pending" },
				previouslyReadPollUrl: "/queue/abc/topic-reads?poll=1",
				previouslyReadComputeUrl: "/queue/abc/topic-reads",
			}),
			{ isAuthenticated: true, emailVerified: undefined, cspNonce: CSP_NONCE },
		).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		const rail = doc.querySelector("[data-test-reader-rail]");
		assert(rail, "the rail must be rendered");
		const section = doc.querySelector("[data-test-reader-topic-reads]");
		assert(section, "the past-reads section renders in the rail");
		expect(section.getAttribute("data-topic-reads-status")).toBe("pending");
		expect(section.parentElement).toBe(rail);
	});

	it("omits the previously-read section when no reading-list link builder is supplied", () => {
		const html = Base(
			ReaderPage(makeArticle(), {
				appOrigin: DEFAULT_APP_ORIGIN,
				backLink: TEST_BACK_LINK,
				renderActions: WebReader,
				readlistFiling: NO_QUEUE_FILING,
				provenance: undefined,
				now: NOW,
				currentPath: TEST_CURRENT_PATH,
				readerPathFor: TEST_READER_PATH,
			}),
			{ isAuthenticated: true, emailVerified: undefined, cspNonce: CSP_NONCE },
		).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		const rail = doc.querySelector("[data-test-reader-rail]");
		assert(rail, "the rail must be rendered");
		expect(railLandmark(rail)).toEqual({ tag: "DIV", label: null });
		expect(railChildTags(rail)).toEqual(["A"]);
	});

	it("offers Share from the toolbar and keeps the float stack to Next read alone", () => {
		const doc = renderReaderDocument(WebReader);

		const opener = doc.querySelector('[data-test-share-slot] [data-test-action="share-open"]');
		assert(opener, "the toolbar must offer Share");
		const dialog = doc.querySelector('[data-test-confirm-popover="share"]');
		assert(dialog, "the share dialog must be rendered for the toolbar to open");
		expect(dialog.id).toBe(opener.getAttribute("popovertarget"));
		expect(dialog.closest("main.reader")).not.toBeNull();
		const floatStack = doc.querySelector("[data-test-reader-float-stack]");
		assert(floatStack, "the float stack stays for Next read");
		expect(Array.from(floatStack.children, (child) => child.classList.item(0))).toEqual(["next-read"]);
	});

	it("withholds Share from a private newsletter issue, whose public link would leak it", () => {
		const html = Base(
			ReaderPage(makeArticle({ url: "email://inbox/owner/2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E" }), {
				appOrigin: DEFAULT_APP_ORIGIN,
				backLink: TEST_BACK_LINK,
				renderActions: WebReader,
				readlistFiling: NO_QUEUE_FILING,
				provenance: undefined,
				now: NOW,
				currentPath: TEST_CURRENT_PATH,
				readerPathFor: TEST_READER_PATH,
			}),
			{ isAuthenticated: true, emailVerified: undefined, cspNonce: CSP_NONCE },
		).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		expect(
			Array.from(doc.querySelectorAll(".article-body__actions--top > *"), (slot) => slot.classList.item(0)),
		).toEqual([
			"article-body__back-slot",
			"article-body__readlists-slot",
			"article-body__mark-read-slot",
			"article-body__downloads-slot",
		]);
		expect(doc.querySelectorAll("[data-test-confirm-popover]").length).toBe(0);
	});

	it("loads the share dialog script in place of the balloon's", () => {
		const doc = renderReaderDocument(WebReader);

		const scripts = Array.from(doc.querySelectorAll("script[src]"), (script) => script.getAttribute("src"));
		expect(scripts).toContain("/client-dist/share-dialog.client.js");
		expect(scripts.filter((src) => src === "/client-dist/share-balloon.client.js")).toEqual([]);
	});

	it("styles the share and naming dialogs, and no longer the balloon", () => {
		expect([
			READER_STYLES.includes(SHARE_DIALOG_STYLES),
			READER_STYLES.includes(READLIST_NAME_FORM_STYLES),
			READER_STYLES.includes(SHARE_BALLOON_STYLES),
		]).toEqual([true, true, false]);
	});

	it("opts the reader <main> out of htmx history snapshots so a boosted open never restores it", () => {
		const html = Base(ReaderPage(makeArticle(), { appOrigin: DEFAULT_APP_ORIGIN, backLink: TEST_BACK_LINK, renderActions: WebReader, readlistFiling: NO_QUEUE_FILING, provenance: undefined, now: NOW, currentPath: TEST_CURRENT_PATH, readerPathFor: TEST_READER_PATH }), {
			isAuthenticated: true,
			emailVerified: undefined,
			cspNonce: CSP_NONCE,
		}).to("text/html").body;
		const doc = new JSDOM(html).window.document;
		expect(doc.querySelector("main.reader")?.getAttribute("hx-history")).toBe("false");
	});

	it("loads the reader-open client so a boosted queue open can fill the reader in place", () => {
		const html = Base(ReaderPage(makeArticle(), { appOrigin: DEFAULT_APP_ORIGIN, backLink: TEST_BACK_LINK, renderActions: WebReader, readlistFiling: NO_QUEUE_FILING, provenance: undefined, now: NOW, currentPath: TEST_CURRENT_PATH, readerPathFor: TEST_READER_PATH }), {
			isAuthenticated: true,
			emailVerified: undefined,
			cspNonce: CSP_NONCE,
		}).to("text/html").body;
		const doc = new JSDOM(html).window.document;
		const script = doc.querySelector('script[src="/client-dist/reader-open.client.js"]');
		assert(script, "the reader page must load the reader-open bundle");
		expect(script.hasAttribute("defer")).toBe(true);
	});

	it("points the header's Original link at the redirect destination for a merged article", () => {
		const article = makeArticle({
			url: SaveableUrlSchema.parse("https://example.com/post.html"),
			destinationUrl: destinationUrl("https://example.com/post"),
		});
		const html = Base(
			ReaderPage(article, { appOrigin: DEFAULT_APP_ORIGIN, backLink: TEST_BACK_LINK, renderActions: WebReader, readlistFiling: NO_QUEUE_FILING, provenance: undefined, now: NOW, currentPath: TEST_CURRENT_PATH, readerPathFor: TEST_READER_PATH }),
			{ isAuthenticated: true, emailVerified: undefined, cspNonce: CSP_NONCE },
		).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		const link = doc.querySelector("[data-test-original-link]");
		assert(link, "header must render an Original link");
		assert.equal(link.getAttribute("href"), "https://example.com/post");
	});

	it("names when the owner saved the article, relative to the render time", () => {
		const html = Base(
			ReaderPage(makeArticle({ savedAt: new Date("2026-08-05T06:00:00.000Z") }), {
				appOrigin: DEFAULT_APP_ORIGIN,
				backLink: TEST_BACK_LINK,
				renderActions: WebReader,
				readlistFiling: NO_QUEUE_FILING,
				provenance: undefined,
				now: NOW,
				currentPath: TEST_CURRENT_PATH,
				readerPathFor: TEST_READER_PATH,
			}),
			{ isAuthenticated: true, emailVerified: undefined, cspNonce: CSP_NONCE },
		).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		const saved = doc.querySelector("[data-test-reader-saved]");
		assert(saved, "the owner's header must name the saved time");
		assert.equal(saved.textContent, "6h ago");
		assert.equal(saved.getAttribute("datetime"), "2026-08-05T06:00:00.000Z");
	});

	it("points the toolbar back link at the supplied backLink href and renders no bottom bar", () => {
		const html = Base(
			ReaderPage(makeArticle(), { appOrigin: DEFAULT_APP_ORIGIN, backLink: TEST_BACK_LINK, renderActions: WebReader, readlistFiling: NO_QUEUE_FILING, provenance: undefined, now: NOW, currentPath: TEST_CURRENT_PATH, readerPathFor: TEST_READER_PATH }),
			{ isAuthenticated: true, emailVerified: undefined, cspNonce: CSP_NONCE },
		).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		assert(
			doc.querySelector(".article-body__toolbar [data-test-back-link]"),
			"the back link must live inside the toolbar row",
		);
		assert.equal(
			doc.querySelector("[data-test-back-link]")?.getAttribute("href"),
			TEST_BACK_LINK.topHref,
		);
		assert.equal(doc.querySelector(".article-body__actions--bottom"), null);
		assert.equal(doc.querySelector("[data-test-back-bottom-link]"), null);
	});

	it("renders the TL;DR collapsed by default (internal reader) — an expand is then a deliberate, measurable act", () => {
		const html = Base(
			ReaderPage(makeArticle(), {
				appOrigin: DEFAULT_APP_ORIGIN,
				summary: { status: "ready", summary: "Key points." },
				crawl: { status: "ready" },
				backLink: TEST_BACK_LINK,
				renderActions: WebReader,
				readlistFiling: NO_QUEUE_FILING,
				provenance: undefined,
				now: NOW,
				currentPath: TEST_CURRENT_PATH,
				readerPathFor: TEST_READER_PATH,
			}),
			{ isAuthenticated: true, emailVerified: undefined, cspNonce: CSP_NONCE },
		).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		const details = doc.querySelector(".tldr-disclosure");
		assert(details, "ready summary <details> must render");
		expect(details.hasAttribute("open")).toBe(false);
	});

	it("stamps the summary <details> with its tracking URL and loads the summary-toggle beacon script", () => {
		const html = Base(
			ReaderPage(makeArticle(), {
				appOrigin: DEFAULT_APP_ORIGIN,
				summary: { status: "ready", summary: "Key points." },
				crawl: { status: "ready" },
				backLink: TEST_BACK_LINK,
				renderActions: WebReader,
				readlistFiling: NO_QUEUE_FILING,
				provenance: undefined,
				now: NOW,
				currentPath: TEST_CURRENT_PATH,
				readerPathFor: TEST_READER_PATH,
			}),
			{ isAuthenticated: true, emailVerified: undefined, cspNonce: CSP_NONCE },
		).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		const details = doc.querySelector(".tldr-disclosure");
		assert(details, "ready summary <details> must render");
		expect(details.getAttribute("data-summary-toggle-url")).toBe(
			`/queue/${articleId.value}/summary-toggle`,
		);
		expect(html).toContain("/client-dist/summary-toggle.client.js");
	});

	it("keeps same-host in-article links in the reader tab while leaving external links alone", () => {
		const article = makeArticle({
			content:
				'<a href="https://readplace.com/queue" target="_blank">my queue</a>' +
				'<a href="https://example.com/other" target="_blank">elsewhere</a>',
		});
		const html = Base(ReaderPage(article, { appOrigin: "https://readplace.com", backLink: TEST_BACK_LINK, renderActions: WebReader, readlistFiling: NO_QUEUE_FILING, provenance: undefined, now: NOW, currentPath: TEST_CURRENT_PATH, readerPathFor: TEST_READER_PATH }), {
			isAuthenticated: true,
			emailVerified: undefined,
			cspNonce: CSP_NONCE,
		}).to("text/html").body;

		const content = new JSDOM(html).window.document.querySelector(
			"[data-test-reader-content]",
		);
		assert(content, "reader content must be rendered");

		const internal = content.querySelector(
			'a[href="https://readplace.com/queue"]',
		);
		const external = content.querySelector(
			'a[href="https://example.com/other"]',
		);
		assert(internal, "internal link must be present");
		assert(external, "external link must be present");
		assert.equal(internal.getAttribute("target"), "_top");
		assert.equal(external.getAttribute("target"), "_blank");
	});

	it("keeps a title carrying markup as text in the exit confirmation", () => {
		const article = makeArticle({
			metadata: {
				title: 'Why <script> & "quotes" break naive templates',
				siteName: siteLabel("example.com"),
				excerpt: "A lovely article.",
				wordCount: 500,
			},
		});
		const html = Base(
			ReaderPage(article, {
				appOrigin: DEFAULT_APP_ORIGIN,
				backLink: TEST_BACK_LINK,
				renderActions: WebReader,
				readlistFiling: NO_QUEUE_FILING,
				provenance: undefined,
				now: NOW,
				currentPath: TEST_CURRENT_PATH,
				readerPathFor: TEST_READER_PATH,
				exitConfirmScopes: [
					EXIT_CONFIRM_SCOPE.articleBody,
					EXIT_CONFIRM_SCOPE.nextReadCard,
				],
			}),
			{ isAuthenticated: true, emailVerified: undefined, cspNonce: CSP_NONCE },
		).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		const articleTitle = doc.querySelector("#reader-exit-confirm-lead");
		assert(articleTitle, "the exit confirmation must name the article it is leaving");
		assert.equal(articleTitle.textContent, 'Why <script> & "quotes" break naive templates');
		assert.equal(articleTitle.className, "sr-only");
		assert.equal(articleTitle.querySelector("script"), null);
	});

	it("asks nothing on exit once the article is read, but still loads the script the next swap needs", () => {
		const html = Base(
			ReaderPage(makeArticle({ status: "read" }), {
				appOrigin: DEFAULT_APP_ORIGIN,
				backLink: TEST_BACK_LINK,
				renderActions: WebReader,
				readlistFiling: NO_QUEUE_FILING,
				provenance: undefined,
				now: NOW,
				currentPath: TEST_CURRENT_PATH,
				readerPathFor: TEST_READER_PATH,
				exitConfirmScopes: [
					EXIT_CONFIRM_SCOPE.articleBody,
					EXIT_CONFIRM_SCOPE.nextReadCard,
				],
			}),
			{ isAuthenticated: true, emailVerified: undefined, cspNonce: CSP_NONCE },
		).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		assert.equal(doc.querySelectorAll("[data-test-confirm-popover='exit-confirm']").length, 0);
		expect(html).toContain("/client-dist/reader-exit-confirm.client.js");
	});

	it("renders the share dialog's link against the supplied appOrigin, not a hardcoded host", () => {
		const html = Base(
			ReaderPage(makeArticle(), { appOrigin: "https://staging.readplace.com", backLink: TEST_BACK_LINK, renderActions: WebReader, readlistFiling: NO_QUEUE_FILING, provenance: undefined, now: NOW, currentPath: TEST_CURRENT_PATH, readerPathFor: TEST_READER_PATH }),
			{ isAuthenticated: true, emailVerified: undefined, cspNonce: CSP_NONCE },
		).to("text/html").body;
		const doc = new JSDOM(html).window.document;

		const copy = doc.querySelector('[data-test-confirm-popover="share"] [data-test-share-copy]');
		assert(copy, "the share dialog must carry its Copy button");
		const copyUrl = new URL(copy.getAttribute("data-share-url") ?? "");
		assert.equal(copyUrl.origin, "https://staging.readplace.com");
		assert.equal(copyUrl.pathname, "/view/example.com/post");

		const facebook = doc.querySelector('[data-test-confirm-popover="share"] [data-test-share-target="facebook"]');
		assert(facebook, "the share dialog must carry its Facebook target");
		const shared = new URL(new URL(facebook.getAttribute("href") ?? "").searchParams.get("u") ?? "");
		assert.equal(shared.origin, "https://staging.readplace.com");
	});

	it("renders the create dialog only when the picker offers create, posting the name back to the reader", () => {
		const offered = renderReaderDocument(WebReader, { ...NO_QUEUE_FILING, picker: PICKER });
		const form = offered.querySelector('[data-test-confirm-popover="readlist-create"] [data-test-form="readlist-create"]');
		assert(form, "the create dialog must render its naming form");
		expect(form.closest("[popover]")?.id).toBe("reader-readlist-create");
		expect(form.getAttribute("action")).toBe(PICKER.create.createUrl);
		const fields = Array.from(form.querySelectorAll("input, label"), (field) =>
			field.tagName === "LABEL" ? "label" : `${field.getAttribute("type")}:${field.getAttribute("name")}`,
		);
		expect(fields).toEqual(["hidden:returnTo", "label", "text:label"]);
		expect(form.querySelector('input[name="returnTo"]')?.getAttribute("value")).toBe(PICKER.returnTo);
		const offeredScripts = Array.from(offered.querySelectorAll("script[src]"), (script) => script.getAttribute("src"));
		expect(offeredScripts).toContain("/client-dist/readlist.client.js");

		const withheld = renderReaderDocument(WebReader, {
			...NO_QUEUE_FILING,
			picker: { ...PICKER, create: undefined },
		});
		expect(withheld.querySelectorAll('[data-test-confirm-popover="readlist-create"]').length).toBe(0);
		const withheldScripts = Array.from(withheld.querySelectorAll("script[src]"), (script) => script.getAttribute("src"));
		expect(withheldScripts.filter((src) => src === "/client-dist/readlist.client.js")).toEqual([]);
	});

	it("mounts the filing toast in the page's status toast slot", () => {
		const filed = renderReaderDocument(WebReader, {
			...NO_QUEUE_FILING,
			toast: {
				message: "Added to Deep Work",
				undoUrl: "/queue/abc/unassign",
				undoFields: { queue: "deep-work", returnTo: "/queue/abc/view" },
			},
		});
		const mount = filed.querySelector("main.reader #status-toast");
		assert(mount, "the reader must carry the status toast mount");
		expect(mount.querySelector("[data-test-toast-message]")?.textContent).toBe("Added to Deep Work");

		const quiet = renderReaderDocument(WebReader).querySelector("main.reader #status-toast");
		assert(quiet, "the reader must carry the status toast mount");
		expect(quiet.innerHTML).toBe("");
	});


	it("lays the article column and the float stack in the main track, beside the rail", () => {
		const doc = renderReaderDocument(WebReader);

		const main = doc.querySelector("main.reader > .reading-layout > .reading-layout__main");
		assert(main, "the main track must sit inside the reading layout");
		const mainChildren = Array.from(main.children, (child) => [
			child.hasAttribute("data-article-body"),
			child.hasAttribute("data-test-reader-float-stack"),
		]);
		expect(mainChildren).toEqual([
			[true, false],
			[false, true],
		]);
		const rail = doc.querySelector(".reading-layout > [data-test-reader-rail]");
		assert(rail, "the rail must sit beside the main track");
		expect(rail.previousElementSibling).toBe(main);
	});

	it.each([
		["web", WebReader],
		["chromeless", ChromelessReader],
	])("ends the %s reader's rail with the Top link, a plain jump to the page top", (_variant, renderActions) => {
		const rail = renderReaderDocument(renderActions).querySelector("[data-test-reader-rail]");
		assert(rail, "the rail must be rendered");

		const top = rail.lastElementChild;
		assert(top, "the rail must hold the Top link");
		expect([top.hasAttribute("data-test-reader-top"), top.getAttribute("href"), top.textContent?.trim()]).toEqual([
			true,
			"#top",
			"Top",
		]);
	});

	it("loads the Top script that reveals the link once the page scrolls past a viewport", () => {
		const doc = renderReaderDocument(WebReader);

		const script = doc.querySelector('script[src="/client-dist/reader-top.client.js"]');
		assert(script, "the reader must load the Top script");
		expect(script.hasAttribute("defer")).toBe(true);
	});
});
