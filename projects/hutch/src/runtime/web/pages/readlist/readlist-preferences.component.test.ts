import assert from "node:assert/strict";
import {
	AliasNameSchema,
	EmailLinkOrdinalSchema,
	type InboxAddressEntry,
	InboxAddressSchema,
	InboxTokenSchema,
} from "@packages/domain/inbox";
import { ReadlistFitOverrideIdSchema, ReadlistSlugSchema, type ReadlistSlug } from "@packages/domain/readlist";
import type { ReadlistFitOverride } from "@packages/provider-contracts/article-store";
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
import type { UpgradeOffer } from "../../shared/upgrade-offer/upgrade-offer";
import { ReadlistPreferencesPage } from "./readlist-preferences.component";
import { DEFAULT_READLIST } from "./readlist.nav";
import type { SubscriptionBannerState } from "./readlist.viewmodel";

const WORK: ReadlistSlug = ReadlistSlugSchema.parse("a1b2c3d4");
const LATER: ReadlistSlug = ReadlistSlugSchema.parse("e5f6a7b8");
const NONCE = generateCspNonce();
const OFFER: UpgradeOffer = { popoverId: "subscribe-plans", plansPath: "/account/plans", checkedPlan: "monthly" };

function page(overrides: {
	purpose?: string;
	wizardOpen?: boolean;
	purposeError?: string;
	inboxes?: readonly InboxAddressEntry[];
	choices?: readonly ReadlistFitOverride[];
	alert?: AlertContent;
	canEdit?: boolean;
	canCreate?: boolean;
	accessIsReadOnly?: boolean;
	offer?: UpgradeOffer;
	subscriptionBanner?: SubscriptionBannerState;
	query?: Record<string, unknown>;
}) {
	return ReadlistPreferencesPage({
		readlist: { slug: WORK, label: "Work Reading", purpose: overrides.purpose },
		rail: {
			readlists: [DEFAULT_READLIST, { slug: WORK, label: "Work Reading" }, { slug: LATER, label: "Later" }],
			activeReadlist: { slug: WORK, label: "Work Reading" },
			newReadlistAction: "/queue/queues",
			limitAlertHref: `/queue?queue=${WORK}&queue_error=limit`,
			canEdit: overrides.canEdit ?? true,
			canCreate: overrides.canCreate ?? true,
			offer: overrides.offer,
			nonEmptyReadlists: [],
		},
		values: { purpose: overrides.purpose },
		wizardOpen: overrides.wizardOpen ?? false,
		purposeError: overrides.purposeError,
		inboxes: overrides.inboxes ?? [],
		choices: overrides.choices ?? [],
		alert: overrides.alert,
		saved: false,
		gmailSenders: undefined,
		accessIsReadOnly: overrides.accessIsReadOnly ?? false,
		subscriptionBanner: overrides.subscriptionBanner ?? { state: "none" },
		onboarding: {
			context: { hasInstallableClient: false },
			dismissed: false,
			completedBefore: false,
			completionUnearned: false,
		},
		query: overrides.query ?? {},
		cspNonce: NONCE,
	});
}

function documentOf(html: string): Document {
	return new JSDOM(html).window.document;
}

function readlistPopovers(doc: Document): (string | null)[] {
	return Array.from(
		doc.querySelectorAll(
			'[data-test-confirm-popover="readlist-rename"], [data-test-confirm-popover="readlist-create"], [data-test-confirm-popover="readlist-delete"]',
		),
		(popover) => popover.getAttribute("data-test-confirm-popover"),
	);
}

function purposePanel(doc: Document): Element {
	const panel = doc.querySelector("[data-test-readlist-preferences]");
	assert(panel, "the preferences panel must render in every state");
	return panel;
}

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
			".readlist-purpose",
			".readlist-inboxes__row",
			".readlist-empty",
			".setup-guide",
			".readlist-preferences__fallback",
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
		const doc = documentOf(page({ canEdit: false, canCreate: false }).content.html);

		expect(doc.querySelectorAll('[data-test-confirm-popover="readlist-delete"]').length).toBe(0);
	});

	it("keeps the delete confirmations and sends the create row to this readlist's cap alert at the cap", () => {
		const doc = documentOf(page({ canCreate: false }).content.html);

		expect(readlistPopovers(doc)).toEqual(["readlist-rename", "readlist-rename", "readlist-delete", "readlist-delete"]);
		const form = doc.querySelector('[data-test-form="readlist-limit"]');
		assert(form, "the capped rail must offer the limit form");
		const landing = new URL(form.getAttribute("action") ?? "", "https://internal.invalid");
		for (const field of form.querySelectorAll('input[type="hidden"]')) {
			landing.searchParams.append(field.getAttribute("name") ?? "", field.getAttribute("value") ?? "");
		}
		expect(`${landing.pathname}${landing.search}`).toBe(
			`/queue?queue=${WORK}&queue_error=limit&utm_source=queue-nav&utm_medium=internal&utm_content=readlist-limit`,
		);
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
			`/queue/queues/${WORK}/preferences?utm_source=queue-preferences&utm_medium=internal&utm_content=save-purpose`,
			`/queue/queues/${WORK}/preferences?utm_source=queue-preferences&utm_medium=internal&utm_content=save-purpose`,
		]);
		expect(hrefs).toEqual([
			`/queue/queues/${WORK}/preferences?utm_source=queue-preferences&utm_medium=internal&utm_content=cancel`,
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

	it("shows a set purpose in the Purpose card above the tabs, opening the edit dialog", () => {
		const doc = documentOf(page({ purpose: "Shipping essays." }).content.html);
		const card = doc.querySelector('.readlist__browse > [data-test-action="readlist-purpose-edit"]');
		assert(card, "the set state must render the Purpose card");

		expect(card.nextElementSibling?.matches("[data-test-filters]")).toBe(true);
		expect(card.getAttribute("popovertarget")).toBe("readlist-preferences-wizard");
		expect(card.querySelector("[data-test-readlist-purpose-text]")?.textContent).toBe("Shipping essays.");
		expect(purposePanel(doc).querySelectorAll("[data-test-preferences-menu]")).toHaveLength(0);
	});

	it("shows no Purpose card while the purpose is unset", () => {
		expect(documentOf(page({}).content.html).querySelectorAll("[data-test-readlist-purpose]")).toHaveLength(0);
	});

	it("posts the purpose from Preferences without naming an origin, so the save lands back on Preferences", () => {
		const doc = documentOf(page({ purpose: "Shipping essays." }).content.html);

		expect(doc.querySelector("[data-test-wizard]")?.getAttribute("action")).toBe(
			`/queue/queues/${WORK}/preferences?utm_source=queue-preferences&utm_medium=internal&utm_content=save-purpose`,
		);
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

	it("carries no purpose delete confirmation in any state", () => {
		const docs = [page({}), page({ purpose: "Shipping essays." })].map((rendered) => documentOf(rendered.content.html));

		expect(docs.map((doc) => doc.querySelectorAll('[data-test-confirm-popover="readlist-purpose-delete"]').length)).toEqual([0, 0]);
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

	it("wraps the panel in the readlist chrome without Add link, with the setup guide beside it", () => {
		const doc = documentOf(page({}).content.html);
		const side = doc.querySelector(".readlist__side");
		assert(side, "the preferences page must render the side column");

		const lead = doc.querySelector(".readlist__lead");
		assert(lead, "the preferences page must render the lead column");
		expect(Array.from(lead.children, (child) => child.getAttribute("data-test-alert"))).toEqual(["readlist"]);
		expect(side.querySelectorAll("[data-test-onboarding]")).toHaveLength(1);
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
		expect(doc.querySelector("[data-test-readlist-purpose-text]")?.textContent).toBe("Shipping essays.");
		expect(
			doc.querySelectorAll(
				'[data-test-action="readlist-preferences-setup"], [data-test-action="readlist-purpose-edit"], [data-test-wizard], .readlist-preferences__fallback, [data-test-confirm-popover="readlist-preferences"]',
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

	it("locks Set up readlist for a read-only reader who can upgrade, with no wizard behind it", () => {
		const doc = documentOf(page({ accessIsReadOnly: true, offer: OFFER }).content.html);
		const panel = purposePanel(doc);

		expect(panel.className).toBe(
			"readlist-listing readlist-preferences readlist-preferences--unset readlist-preferences--read-only",
		);
		const lock = panel.querySelector('.readlist-preferences__unset [data-test-action="upgrade-open"]');
		assert(lock, "the unset card must carry the lock");
		expect(lock.getAttribute("data-test-needs-upgrade")).toBe("set-up-readlist");
		expect(lock.getAttribute("popovertarget")).toBe("subscribe-plans");
		expect(lock.querySelector(".needs-upgrade__label")?.textContent).toBe("Set up readlist");
		expect(lock.classList.contains("readlist-empty__cta")).toBe(true);
		const fallback = panel.querySelector('.readlist-preferences__unset [data-test-action="upgrade-fallback"]');
		expect(fallback?.getAttribute("href")).toBe(
			"/account/plans?utm_source=queue-preferences&utm_medium=internal&utm_content=upgrade-set-up-readlist",
		);
		expect(
			doc.querySelectorAll(
				'[data-test-action="readlist-preferences-setup"], [data-test-wizard], .readlist-preferences__fallback',
			),
		).toHaveLength(0);
	});

	it("locks the set purpose's edit for a read-only reader who can upgrade, with no wizard behind it", () => {
		const doc = documentOf(page({ purpose: "Shipping essays.", accessIsReadOnly: true, offer: OFFER }).content.html);
		const panel = doc.querySelector("[data-test-readlist-purpose]");
		assert(panel, "the set purpose must render its card");

		expect(panel.querySelector("[data-test-readlist-purpose-text]")?.textContent).toBe("Shipping essays.");
		expect(
			Array.from(panel.querySelectorAll('[data-test-action="upgrade-open"]'), (lock) => [
				lock.getAttribute("data-test-needs-upgrade"),
				lock.querySelector(".needs-upgrade__label")?.textContent,
			]),
		).toEqual([["edit-purpose", "Edit"]]);
		expect(
			Array.from(panel.querySelectorAll('[data-test-action="upgrade-fallback"]'), (link) => link.getAttribute("href")),
		).toEqual(["/account/plans?utm_source=queue-preferences&utm_medium=internal&utm_content=upgrade-edit-purpose"]);
		expect(
			doc.querySelectorAll(
				'[data-test-action="readlist-purpose-edit"], [data-test-preferences-menu], [data-test-wizard]',
			),
		).toHaveLength(0);
	});

	it.each([
		["an unset purpose", undefined],
		["a set purpose", "Shipping essays."],
	])("shows no lock on %s when the reader can write, even with an offer", (_case, purpose) => {
		const panel = purposePanel(documentOf(page({ purpose, offer: OFFER }).content.html));

		expect(panel.querySelectorAll("[data-test-needs-upgrade]")).toHaveLength(0);
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
		).toBe("Saves to All and Later");
	});

	it("stacks the readlist's remembered choices under its inboxes", () => {
		const dovetail: ReadlistFitOverride = {
			id: ReadlistFitOverrideIdSchema.parse("0009007199254740-1760000000000-message-0001"),
			url: "https://finewoodworking.com/dovetail",
			anchorText: "How to cut a dovetail by hand",
			host: "finewoodworking.com",
			readerVerdict: "keep",
			receivedAtMessageId: "1760000000000-message",
			ordinal: EmailLinkOrdinalSchema.parse("0001"),
			createdAt: new Date("2026-10-12T09:00:00.000Z"),
		};
		const doc = documentOf(page({ purpose: "Woodworking", choices: [dovetail] }).content.html);
		const inboxes = doc.querySelector("[data-test-readlist-inboxes]");
		assert(inboxes, "the inboxes section renders in every state");

		expect(inboxes.nextElementSibling?.hasAttribute("data-test-readlist-choices")).toBe(true);
	});

	it("raises a refused inbox routing as the page's alert, ahead of any other", () => {
		const doc = documentOf(
			page({
				alert: INBOX_UNAVAILABLE_ALERT,
				query: { queue_error: "rename_invalid-name" },
			}).content.html,
		);
		const alert = doc.querySelector('[data-test-alert="readlist"]');
		assert(alert, "the alert must render in every state");

		expect(alert.classList.contains("alert--visible")).toBe(true);
		expect(alert.querySelector("[data-test-alert-title]")?.textContent).toBe(
			"That custom email isn't available",
		);
		expect(alert.querySelector("[data-test-alert-message]")?.textContent).toBe(
			"It may have been disabled. Pick another custom email.",
		);
	});
});
