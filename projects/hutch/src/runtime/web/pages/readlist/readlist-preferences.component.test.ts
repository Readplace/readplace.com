import assert from "node:assert/strict";
import { ReadlistSlugSchema, type ReadlistSlug } from "@packages/domain/readlist";
import { JSDOM } from "jsdom";
import { ReadlistPreferencesPage } from "./readlist-preferences.component";
import { READLIST_PAGE_SCRIPTS } from "./readlist.component";
import { DEFAULT_READLIST } from "./readlist.nav";

const WORK: ReadlistSlug = ReadlistSlugSchema.parse("a1b2c3d4");
const LATER: ReadlistSlug = ReadlistSlugSchema.parse("e5f6a7b8");

function page(overrides: {
	purpose?: string;
	wizardOpen?: boolean;
	purposeError?: string;
	canCreate?: boolean;
	preferencesEnabled?: boolean;
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
		preferencesEnabled: overrides.preferencesEnabled ?? true,
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
			".readlist__listing",
			".confirm-popover",
			".wizard__textarea",
			".readlist-preferences__purpose",
		]) {
			expect(styles).toContain(selector);
		}
	});

	it("renders under the readlist body class, so the listing's chrome applies unchanged", () => {
		expect(page({}).bodyClass).toBe("page-readlist");
	});

	it("mounts the toast target the inline rename writes into", () => {
		const doc = documentOf(page({}).content.html);
		const mount = doc.getElementById("status-toast");
		assert(mount, "the rail's rename needs its toast mount on every page it appears on");

		expect(mount.textContent).toBe("");
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
