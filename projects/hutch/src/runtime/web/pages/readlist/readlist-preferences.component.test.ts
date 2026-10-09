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
	readlistPageScripts,
} from "./readlist.component";
import { generateCspNonce } from "@packages/web-shell";
import type { AlertContent } from "@packages/web-shell";
import { INBOX_UNAVAILABLE_ALERT } from "./readlist-alerts";
import { readlistRenamePopoverId } from "./readlist-rename.component";
import { ReadlistPreferencesPage } from "./readlist-preferences.component";
import { DEFAULT_READLIST } from "./readlist.nav";
import type { SubscriptionBannerState } from "./readlist.viewmodel";

const WORK: ReadlistSlug = ReadlistSlugSchema.parse("a1b2c3d4");
const LATER: ReadlistSlug = ReadlistSlugSchema.parse("e5f6a7b8");
const NONCE = generateCspNonce();

function page(overrides: {
	purpose?: string;
	wizardOpen?: boolean;
	purposeError?: string;
	inboxes?: readonly InboxAddressEntry[];
	inboxAlert?: AlertContent;
	canCreate?: boolean;
	preferencesEnabled?: boolean;
	accessIsReadOnly?: boolean;
	subscriptionBanner?: SubscriptionBannerState;
	query?: Record<string, unknown>;
}) {
	return ReadlistPreferencesPage({
		readlist: { slug: WORK, label: "Work Reading", purpose: overrides.purpose },
		rail: {
			readlists: [DEFAULT_READLIST, { slug: WORK, label: "Work Reading" }, { slug: LATER, label: "Later" }],
			activeReadlist: { slug: WORK, label: "Work Reading" },
			newReadlistAction: "/queue/queues",
			canCreate: overrides.canCreate ?? true,
			nonEmptyReadlists: [],
		},
		values: { purpose: overrides.purpose },
		wizardOpen: overrides.wizardOpen ?? false,
		purposeError: overrides.purposeError,
		inboxes: overrides.inboxes ?? [],
		inboxAlert: overrides.inboxAlert,
		preferencesEnabled: overrides.preferencesEnabled ?? true,
		accessIsReadOnly: overrides.accessIsReadOnly ?? false,
		subscriptionBanner: overrides.subscriptionBanner ?? { state: "none" },
		onboarding: {
			context: { hasInstallableClient: false },
			dismissed: false,
			completedBefore: false,
			completionUnearned: false,
		},
		saveTip: { state: "due", html: "" },
		query: overrides.query ?? {},
		cspNonce: NONCE,
	});
}

function documentOf(html: string): Document {
	return new JSDOM(html).window.document;
}

function purposePanel(doc: Document): Element {
	const panel = doc.querySelector("[data-test-readlist-preferences]");
	assert(panel, "the preferences panel must render in every state");
	return panel;
}

function testActionsOf(root: ParentNode, selector: string): (string | null)[] {
	return Array.from(root.querySelectorAll(selector), (control) => control.getAttribute("data-test-action"));
}

const PURPOSE_DELETE_ACTION = `/queue/queues/${WORK}/preferences/purpose/delete?feature=pref&utm_source=queue-preferences&utm_medium=internal`;

describe("ReadlistPreferencesPage", () => {
	it("titles the tab with the readlist, so the inline rename keeps rewriting a title it recognises", () => {
		expect(page({}).seo.title).toBe("Work Reading — Readplace");
	});

	it("keeps a private readlist out of search results", () => {
		expect(page({}).seo.robots).toBe("noindex, nofollow");
	});

	it("ships the readlist page's own scripts, so a boosted hop to the listing finds them loaded", () => {
		expect(page({}).scripts).toBe(readlistPageScripts(NONCE));
	});

	it("carries the stylesheet of every part it renders", () => {
		const styles = page({}).styles;

		for (const selector of [
			".readlist-listing",
			".readlist-nav",
			".readlist-row",
			".readlist-row--selected",
			".menu__panel",
			".confirm-popover",
			".wizard__title",
			".readlist-preferences__purpose",
			".readlist-inboxes__row",
			".readlist-empty",
			".setup-guide",
			".readlist-preferences__set",
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

	it("carries the create dialog the rail's create row opens", () => {
		const doc = documentOf(page({}).content.html);

		const popover = doc.querySelector('[data-test-confirm-popover="readlist-create"]');
		assert(popover, "the create dialog must render on the preferences page");
		expect(popover.getAttribute("id")).toBe("readlist-create");
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

	it("labels the To Read tab without a count or a counts-swap target", () => {
		const doc = documentOf(page({}).content.html);
		const label = doc.querySelector('[data-test-filter="unread"] .underline-tabs__label');
		assert(label, "the To Read tab must render its label");
		const text = label.firstElementChild;
		assert(text, "the label must wrap its text");

		expect({
			text: label.textContent,
			widest: label.getAttribute("data-widest"),
			textAttributes: text.getAttributeNames(),
		}).toEqual({ text: "To Read", widest: "To Read", textAttributes: [] });
	});

	it("titles the alert a rejected rename lands on", () => {
		const doc = documentOf(page({ query: { queue_error: "rename_invalid-name" } }).content.html);
		const alert = doc.querySelector('[data-test-alert="readlist"]');
		assert(alert, "the alert must render in every state");
		const title = alert.querySelector("[data-test-alert-title]");
		assert(title, "a recognised alert must carry its title");

		expect(alert.classList.contains("alert--visible")).toBe(true);
		expect(alert.getAttribute("data-test-alert-variant")).toBe("error");
		expect(alert.getAttribute("role")).toBe("alert");
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
			`/queue/queues/${WORK}/preferences?feature=pref&utm_source=queue-preferences&utm_medium=internal&utm_content=cancel`,
		]);
	});

	it("offers to set the readlist up while it has no purpose, with no options to show", () => {
		const panel = purposePanel(documentOf(page({}).content.html));
		const empty = panel.querySelector("[data-test-preferences-empty]");
		assert(empty, "the unset state must show the set-up card");

		expect(empty.querySelector(".readlist-empty__title")?.textContent).toBe("Set up your readlist");
		expect(empty.querySelector(".readlist-empty__text")?.textContent).toBe(
			"Personalise this readlist by choosing what you want to read in it.",
		);
		expect(
			Array.from(empty.querySelectorAll('[data-test-action="readlist-preferences-setup"]'), (cta) => ({
				label: cta.textContent,
				opens: cta.getAttribute("popovertarget"),
				className: cta.className,
			})),
		).toEqual([
			{
				label: "Set up readlist",
				opens: "readlist-preferences-wizard",
				className: "btn btn--neutral readlist-empty__cta",
			},
		]);
		expect(panel.querySelectorAll("[data-test-preferences-menu]")).toHaveLength(0);
	});

	it("shows a set purpose as plain text with its options menu: Edit and Delete, and a direct Delete without popovers", () => {
		const panel = purposePanel(documentOf(page({ purpose: "Shipping essays." }).content.html));
		const menu = panel.querySelector("[data-test-preferences-menu]");
		assert(menu, "the set state must offer the purpose's options menu");
		const fallback = menu.querySelector(".readlist-preferences__menu-fallback");
		assert(fallback, "the menu must carry a delete that works without popovers");

		expect(panel.querySelector("[data-test-preferences-purpose]")?.textContent).toBe("Shipping essays.");
		expect(testActionsOf(menu, ".readlist-preferences__menu-trigger")).toEqual([
			"readlist-preferences-edit",
			"readlist-preferences-delete",
		]);
		expect(testActionsOf(menu, ".readlist-preferences__menu-fallback [data-test-action]")).toEqual([
			"readlist-preferences-delete-fallback",
		]);
		expect(fallback.getAttribute("action")).toBe(`${PURPOSE_DELETE_ACTION}&utm_content=delete-purpose-fallback`);
		expect(fallback.getAttribute("hx-boost")).toBe("false");
	});

	it.each([
		["unset", undefined],
		["set", "Shipping essays."],
	])("opens only dialogs that exist on the page while the purpose is %s", (_state, purpose) => {
		const doc = documentOf(page({ purpose }).content.html);
		const targets = Array.from(doc.querySelectorAll("[popovertarget]"), (trigger) =>
			trigger.getAttribute("popovertarget"),
		);

		expect(targets.length).toBeGreaterThan(0);
		expect(targets.filter((target) => target === null || doc.getElementById(target) === null)).toEqual([]);
	});

	it("asks before deleting a set purpose, posting the clear with its own tag", () => {
		const doc = documentOf(page({ purpose: "Shipping essays." }).content.html);
		const confirm = doc.querySelector('[data-test-confirm-popover="readlist-purpose-delete"]');
		assert(confirm, "the set state must carry the purpose delete confirmation");

		expect(confirm.querySelector(".confirm-popover__title")?.textContent).toBe("Delete this purpose?");
		expect(confirm.querySelector(".confirm-popover__body")?.textContent).toBe(
			"The readlist and its articles stay. Newsletters saved to it will keep every link until you set a new purpose.",
		);
		expect(confirm.querySelector("form")?.getAttribute("action")).toBe(
			`${PURPOSE_DELETE_ACTION}&utm_content=delete-purpose`,
		);
	});

	it("carries no purpose delete confirmation while there is no purpose to delete", () => {
		const doc = documentOf(page({}).content.html);

		expect(doc.querySelectorAll('[data-test-confirm-popover="readlist-purpose-delete"]')).toHaveLength(0);
	});

	it("asks the setup question in the dialog's title while the purpose is unset", () => {
		const doc = documentOf(page({}).content.html);
		const dialog = doc.querySelector('[data-test-confirm-popover="readlist-preferences"]');
		assert(dialog, "the wizard's dialog must render");

		expect(dialog.querySelector(".confirm-popover__title")?.textContent).toBe("What's this readlist for?");
		expect(dialog.querySelectorAll(".confirm-popover__subheading")).toHaveLength(0);
	});

	it("titles the dialog with the edit and asks the question under it once the purpose is set", () => {
		const doc = documentOf(page({ purpose: "Shipping essays." }).content.html);
		const dialog = doc.querySelector('[data-test-confirm-popover="readlist-preferences"]');
		assert(dialog, "the wizard's dialog must render");

		expect(dialog.querySelector(".confirm-popover__title")?.textContent).toBe("Edit readlist purpose");
		expect(
			Array.from(dialog.querySelectorAll(".confirm-popover__subheading"), (subheading) => subheading.textContent),
		).toEqual(["What's this readlist for?"]);
	});

	it("wraps the panel in the readlist chrome: the save card ahead of it and the setup guide beside it", () => {
		const doc = documentOf(page({}).content.html);
		const side = doc.querySelector(".readlist__side");
		assert(side, "the preferences page must render the side column");

		expect(doc.querySelectorAll(".readlist__lead [data-test-save-card]")).toHaveLength(1);
		expect(side.querySelectorAll("[data-test-onboarding]")).toHaveLength(1);
	});

	it("attributes a subscribe choice made from this page to the preferences banner", () => {
		const doc = documentOf(
			page({
				subscriptionBanner: {
					state: "trial-countdown",
					daysLeft: 2,
					daysLeftWord: "days",
					remaining: { days: 2, hours: 0, minutes: 0, seconds: 0, totalMs: 0 },
					checkedPlan: "yearly",
				},
			}).content.html,
		);
		const form = doc.querySelector('#subscribe-plans form[data-test-form="subscribe-plans"]');
		assert(form, "a trial countdown must offer the subscribe-plans popover");

		expect(new URL(form.getAttribute("action") ?? "", "https://readplace.test").searchParams.get("utm_source")).toBe(
			"queue-preferences-banner",
		);
	});

	it("shows a read-only reader what they wrote, with nothing to change it with", () => {
		const doc = documentOf(
			page({
				purpose: "Shipping essays.",
				accessIsReadOnly: true,
				wizardOpen: true,
				purposeError: "Say what this readlist is for, in up to 10,000 characters.",
			}).content.html,
		);
		const panel = purposePanel(doc);

		expect(panel.className).toBe(
			"readlist-listing readlist-preferences readlist-preferences--set readlist-preferences--read-only",
		);
		expect(panel.querySelector("[data-test-preferences-purpose]")?.textContent).toBe("Shipping essays.");
		expect(
			doc.querySelectorAll(
				'[data-test-action="readlist-preferences-setup"], [data-test-preferences-menu], [data-test-wizard], .readlist-preferences__fallback, [data-test-confirm-popover="readlist-preferences"], [data-test-confirm-popover="readlist-purpose-delete"]',
			),
		).toHaveLength(0);
	});

	it("shows a read-only reader the unset card, with no way to set it up", () => {
		const panel = purposePanel(documentOf(page({ accessIsReadOnly: true }).content.html));

		expect(panel.className).toBe(
			"readlist-listing readlist-preferences readlist-preferences--unset readlist-preferences--read-only",
		);
		expect(panel.querySelector(".readlist-empty__title")?.textContent).toBe("Set up your readlist");
		expect(panel.querySelectorAll('[data-test-action="readlist-preferences-setup"]')).toHaveLength(0);
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
		const alert = doc.querySelector('[data-test-alert="readlist"]');
		assert(alert, "the alert must render in every state");

		expect(alert.classList.contains("alert--visible")).toBe(true);
		expect(alert.querySelector("[data-test-alert-title]")?.textContent).toBe(
			"That inbox isn't available",
		);
		expect(alert.querySelector("[data-test-alert-message]")?.textContent).toBe(
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
			`/queue/queues/${WORK}/preferences?utm_source=queue-preferences&utm_medium=internal&utm_content=cancel`,
		]);
	});
});
