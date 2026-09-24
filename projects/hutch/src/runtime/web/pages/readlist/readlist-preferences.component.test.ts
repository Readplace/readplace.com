import assert from "node:assert/strict";
import {
	AliasNameSchema,
	type InboxAddressEntry,
	InboxAddressSchema,
	InboxTokenSchema,
} from "@packages/domain/inbox";
import { ReadlistSlugSchema, type ReadlistSlug } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { JSDOM } from "jsdom";
import {
	READLIST_BODY_CLASS,
	READLIST_PAGE_SCRIPTS,
} from "./readlist.component";
import { INBOX_UNAVAILABLE_ALERT, type ReadlistAlert } from "./readlist-alerts";
import { readlistRenamePopoverId } from "./readlist-rename.component";
import { ReadlistPreferencesPage } from "./readlist-preferences.component";
import { DEFAULT_READLIST } from "./readlist.nav";

const WORK: ReadlistSlug = ReadlistSlugSchema.parse("a1b2c3d4");
const LATER: ReadlistSlug = ReadlistSlugSchema.parse("e5f6a7b8");

function page(overrides: {
	purpose?: string;
	wizardOpen?: boolean;
	purposeError?: string;
	inboxes?: readonly InboxAddressEntry[];
	inboxAlert?: ReadlistAlert;
	canCreate?: boolean;
	preferencesEnabled?: boolean;
	query?: Record<string, unknown>;
}) {
	return ReadlistPreferencesPage({
		readlist: { slug: WORK, label: "Work Reading", purpose: overrides.purpose },
		rail: {
			readlists: [DEFAULT_READLIST, { slug: WORK, label: "Work Reading" }, { slug: LATER, label: "Later" }],
			activeReadlist: { slug: WORK, label: "Work Reading" },
			newReadlistAction: "/queue/queues",
			canCreate: overrides.canCreate ?? true,
		},
		values: { purpose: overrides.purpose },
		wizardOpen: overrides.wizardOpen ?? false,
		purposeError: overrides.purposeError,
		inboxes: overrides.inboxes ?? [],
		inboxAlert: overrides.inboxAlert,
		preferencesEnabled: overrides.preferencesEnabled ?? true,
		query: overrides.query ?? {},
	});
}

function documentOf(html: string): Document {
	return new JSDOM(html).window.document;
}

describe("ReadlistPreferencesPage", () => {
	it("titles the tab with the readlist, so the inline rename keeps rewriting a title it recognises", () => {
		expect(page({}).seo.title).toBe("Work Reading — Readplace");
	});

	it("keeps a private readlist out of search results", () => {
		expect(page({}).seo.robots).toBe("noindex, nofollow");
	});

	it("ships the readlist page's own scripts, so a boosted hop to the listing finds them loaded", () => {
		expect(page({}).scripts).toBe(READLIST_PAGE_SCRIPTS);
	});

	it("carries the stylesheet of every part it renders", () => {
		const styles = page({}).styles;

		for (const selector of [
			".readlist-listing",
			".readlist-nav",
			".confirm-popover",
			".wizard__textarea",
			".readlist-preferences__purpose",
			".readlist-inboxes__row",
		]) {
			expect(styles).toContain(selector);
		}
	});

	it("renders under the readlist body class, so the listing's chrome applies unchanged", () => {
		expect(page({}).bodyClass).toBe(READLIST_BODY_CLASS);
	});

	it("carries a rename dialog for each readlist the rail can rename", () => {
		const doc = documentOf(page({}).content.html);
		const panels = Array.from(
			doc.querySelectorAll('[data-test-confirm-popover="readlist-rename"]'),
			(panel) => panel.getAttribute("id"),
		);

		expect(panels).toEqual([
			readlistRenamePopoverId(WORK),
			readlistRenamePopoverId(LATER),
		]);
	});

	it("marks the readlist being read as the current one in the rail", () => {
		const doc = documentOf(page({}).content.html);
		const current = Array.from(
			doc.querySelectorAll("[data-test-readlist][aria-current='page']"),
			(link) => link.getAttribute("data-test-readlist"),
		);

		expect(current).toEqual([WORK]);
	});

	it("names Preferences as the tab being read", () => {
		const doc = documentOf(page({}).content.html);
		const tabs = Array.from(doc.querySelectorAll("[data-test-filter]"), (tab) => ({
			filter: tab.getAttribute("data-test-filter"),
			current: tab.getAttribute("aria-current"),
		}));

		expect(tabs).toEqual([
			{ filter: "unread", current: null },
			{ filter: "read", current: null },
			{ filter: "preferences", current: "page" },
		]);
	});

	it("titles the alert a rejected rename lands on", () => {
		const doc = documentOf(page({ query: { queue_error: "rename_invalid-name" } }).content.html);
		const alert = doc.querySelector("[data-test-readlist-error]");
		assert(alert, "the alert must render in every state");
		const title = alert.querySelector("[data-test-readlist-error-title]");
		assert(title, "a recognised alert must carry its title");

		expect(alert.classList.contains("readlist__alert--visible")).toBe(true);
		expect(title.textContent).toBe("Couldn't rename the readlist");
	});

	it("carries a delete confirmation for each readlist the rail can delete", () => {
		const doc = documentOf(page({}).content.html);
		const panels = Array.from(
			doc.querySelectorAll('[data-test-confirm-popover="readlist-delete"]'),
			(panel) => panel.getAttribute("id"),
		);

		expect(panels).toEqual([
			`readlist-remove-confirm-${WORK}`,
			`readlist-remove-confirm-${LATER}`,
		]);
	});

	it("drops the delete confirmations when the reader cannot change their readlists", () => {
		const doc = documentOf(page({ canCreate: false }).content.html);

		expect(doc.querySelectorAll('[data-test-confirm-popover="readlist-delete"]').length).toBe(0);
	});

	it("opens the wizard on the panel when asked, leaving the read-only view behind it", () => {
		const doc = documentOf(page({ purpose: "Shipping essays.", wizardOpen: true }).content.html);
		const panel = doc.querySelector("[data-test-readlist-preferences]");
		assert(panel, "the preferences panel must render in every state");

		expect(panel.className).toContain("readlist-preferences--set");
		expect(panel.className).toContain("readlist-preferences--wizard-open");
	});

	it("tags both wizard surfaces and the cancel link so every click is attributable", () => {
		const doc = documentOf(page({}).content.html);
		const hrefs = Array.from(doc.querySelectorAll("[data-test-wizard-surface] a[href]"), (link) =>
			link.getAttribute("href"),
		);
		const actions = Array.from(doc.querySelectorAll("[data-test-wizard-surface]"), (form) =>
			form.getAttribute("action"),
		);

		expect(actions).toEqual([
			`/queue/queues/${WORK}/preferences?feature=pref&utm_source=queue-preferences&utm_medium=internal&utm_content=save-purpose`,
			`/queue/queues/${WORK}/preferences?feature=pref&utm_source=queue-preferences&utm_medium=internal&utm_content=save-purpose`,
		]);
		expect(hrefs).toEqual([
			`/queue?queue=${WORK}&feature=pref&utm_source=queue-preferences&utm_medium=internal&utm_content=cancel`,
		]);
	});

	it("stacks the readlist's inboxes under its purpose panel", () => {
		const news: InboxAddressEntry = {
			address: InboxAddressSchema.parse("news-a7b2c9@read.place"),
			userId: UserIdSchema.parse("reader-1"),
			name: AliasNameSchema.parse("news"),
			token: InboxTokenSchema.parse("a7b2c9"),
			createdAt: "2026-09-24T00:00:00.000Z",
			disabledAt: undefined,
			purpose: "user-alias",
			readlist: LATER,
		};
		const doc = documentOf(page({ inboxes: [news] }).content.html);
		const purposePanel = doc.querySelector("[data-test-readlist-preferences]");
		assert(purposePanel, "the preferences panel must render in every state");

		expect(purposePanel.nextElementSibling?.hasAttribute("data-test-readlist-inboxes")).toBe(true);
		expect(
			doc.querySelector(
				'[data-test-preferences-inbox="news-a7b2c9@read.place"] [data-test-inbox-destination]',
			)?.textContent,
		).toBe("Goes to Later");
	});

	it("raises a refused inbox routing as the page's alert, ahead of any other", () => {
		const doc = documentOf(
			page({
				inboxAlert: INBOX_UNAVAILABLE_ALERT,
				query: { queue_error: "rename_invalid-name" },
			}).content.html,
		);
		const alert = doc.querySelector("[data-test-readlist-error]");
		assert(alert, "the alert must render in every state");

		expect(alert.classList.contains("readlist__alert--visible")).toBe(true);
		expect(alert.querySelector("[data-test-readlist-error-title]")?.textContent).toBe(
			"That inbox isn't available",
		);
		expect(alert.querySelector(".readlist__alert-body")?.textContent).toBe(
			"It may have been turned off. Pick another inbox.",
		);
	});

	it("drops the feature from the flow when the reader never asked for it", () => {
		const doc = documentOf(page({ preferencesEnabled: false }).content.html);
		const actions = Array.from(doc.querySelectorAll("[data-test-wizard-surface]"), (form) =>
			form.getAttribute("action"),
		);
		const hrefs = Array.from(doc.querySelectorAll("[data-test-wizard-surface] a[href]"), (link) =>
			link.getAttribute("href"),
		);

		expect(actions).toEqual([
			`/queue/queues/${WORK}/preferences?utm_source=queue-preferences&utm_medium=internal&utm_content=save-purpose`,
			`/queue/queues/${WORK}/preferences?utm_source=queue-preferences&utm_medium=internal&utm_content=save-purpose`,
		]);
		expect(hrefs).toEqual([
			`/queue?queue=${WORK}&utm_source=queue-preferences&utm_medium=internal&utm_content=cancel`,
		]);
	});
});
