import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { toAbsoluteDate, toAbsoluteTime } from "@packages/web-shell/local-time.format";
import type { ArticleVersion } from "../../article-reader/article-reader.types";
import { renderArticleHistory, renderOfflineCopyTemplate } from "./article-history.component";

const REMOVE_VERSION_URL = "/queue/abc/remove-my-version";
const CURRENT_MARKER = "article-history__marker article-history__marker--current";
const EARLIER_MARKER = "article-history__marker article-history__marker--earlier";

function parse(html: string): Document {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

function versionAt(iso: string): ArticleVersion {
	return { minuteId: iso, date: toAbsoluteDate({ iso }), time: toAbsoluteTime({ iso }) };
}

function pick(scope: ParentNode, selector: string): Element {
	const element = scope.querySelector(selector);
	assert(element, `${selector} must be rendered`);
	return element;
}

function rowsOf(scope: ParentNode): Element[] {
	return Array.from(scope.querySelectorAll("[data-test-article-history-version]"));
}

function rowKeys(scope: ParentNode): (string | null)[] {
	return rowsOf(scope).map((row) => row.getAttribute("data-test-article-history-version"));
}

function badgeLabels(scope: ParentNode): (string | null)[] {
	return Array.from(scope.querySelectorAll("[data-test-article-history-badge]"), (badge) => badge.textContent);
}

function markerClasses(scope: ParentNode): string[] {
	return rowsOf(scope).map((row) => pick(row, ".article-history__marker").className);
}

function removeControlCounts(scope: ParentNode): { forms: number; triggers: number; panels: number }[] {
	return rowsOf(scope).map((row) => ({
		forms: row.querySelectorAll("form[data-test-article-history-remove]").length,
		triggers: row.querySelectorAll('[data-test-action="article-version-delete-open"]').length,
		panels: row.querySelectorAll('[data-test-confirm-popover="article-version-delete"]').length,
	}));
}

describe("renderArticleHistory", () => {
	it("renders nothing before any crawl version exists", () => {
		expect(renderArticleHistory({ versions: [] })).toBe("");
	});

	it("renders one version as an open card titled Article history, its row marked current with a date over a time", () => {
		const doc = parse(renderArticleHistory({ versions: [versionAt("2026-07-10T09:14Z")] }));

		const card = pick(doc, "details[data-test-article-history]");
		expect(card.className).toBe("disclosure-card article-history");
		expect(card.hasAttribute("open")).toBe(true);
		const header = pick(card, ":scope > summary.disclosure-card__header");
		expect(pick(header, ".disclosure-card__title").textContent).toBe("Article history");
		expect(header.querySelectorAll(".disclosure-card__chevron svg")).toHaveLength(1);
		expect(rowKeys(card)).toEqual(["canonical"]);
		const row = pick(card, '[data-test-article-history-version="canonical"]');
		expect(badgeLabels(row)).toEqual(["Current"]);
		expect(pick(row, '[data-test-article-history-badge="state"]').className).toBe(
			"chip chip--badge chip--accent article-history__badge",
		);
		expect(markerClasses(card)).toEqual([CURRENT_MARKER]);
		expect(pick(row, ".article-history__marker").getAttribute("aria-hidden")).toBe("true");
		expect(row.querySelectorAll(".article-history__marker svg")).toHaveLength(1);
		const date = pick(row, 'time[data-local-time="date"]');
		expect(date.getAttribute("datetime")).toBe("2026-07-10T09:14Z");
		expect(date.textContent).toBe("Jul 10, 2026");
		const time = pick(row, 'time[data-local-time="time"]');
		expect(time.getAttribute("datetime")).toBe("2026-07-10T09:14Z");
		expect(time.textContent).toBe("09:14 AM");
	});

	it("lists several versions newest first, with Current on the newest row only and plain earlier rows", () => {
		const doc = parse(
			renderArticleHistory({
				versions: [
					versionAt("2026-07-10T09:14Z"),
					versionAt("2026-06-28T22:01Z"),
					versionAt("2026-03-26T14:32Z"),
				],
			}),
		);

		expect(rowKeys(doc)).toEqual(["canonical", "2026-06-28T22:01Z", "2026-03-26T14:32Z"]);
		expect(rowsOf(doc).map((row) => badgeLabels(row))).toEqual([["Current"], [], []]);
		expect(markerClasses(doc)).toEqual([CURRENT_MARKER, EARLIER_MARKER, EARLIER_MARKER]);
		expect(rowsOf(doc).map((row) => Array.from(row.attributes, (attribute) => attribute.name))).toEqual([
			["class", "data-test-article-history-version"],
			["class", "data-test-article-history-version"],
			["class", "data-test-article-history-version"],
		]);
		const earlier = pick(doc, '[data-test-article-history-version="2026-06-28T22:01Z"]');
		expect(pick(earlier, 'time[data-local-time="date"]').textContent).toBe("Jun 28, 2026");
		expect(pick(earlier, 'time[data-local-time="time"]').textContent).toBe("10:01 PM");
	});

	it("holds the versions in an ordered list that keeps its list role under the list reset", () => {
		const doc = parse(
			renderArticleHistory({ versions: [versionAt("2026-03-26T14:32Z"), versionAt("2026-01-01T00:00Z")] }),
		);

		const list = pick(doc, "details[data-test-article-history] > ol.article-history__versions");
		expect(list.className).toBe("disclosure-card__body article-history__versions");
		expect(list.getAttribute("role")).toBe("list");
		expect(Array.from(list.children, (child) => child.tagName)).toEqual(["LI", "LI"]);
	});

	it("renders no removal control when no removal context is supplied (public /view, admin recrawl)", () => {
		const doc = parse(
			renderArticleHistory({ versions: [versionAt("2026-07-10T09:14Z"), versionAt("2026-06-28T22:01Z")] }),
		);

		expect(removeControlCounts(doc)).toEqual([
			{ forms: 0, triggers: 0, panels: 0 },
			{ forms: 0, triggers: 0, panels: 0 },
		]);
	});

	it("gives the row the viewer authored a delete form, a dialog trigger and the dialog that confirms it", () => {
		const doc = parse(
			renderArticleHistory({
				versions: [versionAt("2026-07-10T09:14Z"), versionAt("2026-06-28T22:01Z")],
				removal: { authoredMinuteIds: ["2026-07-10T09:14Z"], removeVersionUrl: REMOVE_VERSION_URL },
			}),
		);

		expect(removeControlCounts(doc)).toEqual([
			{ forms: 1, triggers: 1, panels: 1 },
			{ forms: 0, triggers: 0, panels: 0 },
		]);
		const row = pick(doc, '[data-test-article-history-version="canonical"]');
		expect(badgeLabels(row)).toEqual(["Current"]);
		const date = pick(row, 'time[data-local-time="date"]');
		expect(date.id).toBe("article-history-date-0");

		const form = pick(row, "form[data-test-article-history-remove]");
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("action")).toBe(REMOVE_VERSION_URL);
		expect(pick(form, 'input[name="versionMinuteId"]').getAttribute("value")).toBe("2026-07-10T09:14Z");
		const submit = pick(form, 'button[type="submit"]');
		expect(pick(submit, ".sr-only").textContent).toBe("Delete this version");
		expect(submit.querySelectorAll("svg")).toHaveLength(1);
		expect(submit.getAttribute("aria-describedby")).toBe(date.id);

		const trigger = pick(row, '[data-test-action="article-version-delete-open"]');
		expect(trigger.getAttribute("type")).toBe("button");
		expect(trigger.className).toBe("article-history__remove-btn article-history__remove-trigger");
		expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
		expect(trigger.getAttribute("aria-describedby")).toBe(date.id);
		expect(pick(trigger, ".sr-only").textContent).toBe("Delete this version");
		expect(trigger.querySelectorAll("svg")).toHaveLength(1);

		const panel = pick(row, '[data-test-confirm-popover="article-version-delete"]');
		expect(trigger.getAttribute("popovertarget")).toBe(panel.id);
		expect(panel.id).toBe("article-history-delete-0");
		expect(panel.getAttribute("data-test-confirm-subject")).toBe("2026-07-10T09:14Z");
		expect(pick(panel, ".confirm-popover__title").textContent).toBe("Delete this version?");
		expect(pick(panel, ".confirm-popover__body").textContent).toBe(
			"This version will be permanently deleted. The article stays in your readlist.",
		);
		const confirmForm = pick(panel, "form.confirm-popover__actions");
		expect(confirmForm.getAttribute("method")).toBe("POST");
		expect(confirmForm.getAttribute("action")).toBe(REMOVE_VERSION_URL);
		expect(pick(confirmForm, 'input[name="versionMinuteId"]').getAttribute("value")).toBe("2026-07-10T09:14Z");
		const cancel = pick(confirmForm, '[data-test-action="article-version-delete-cancel"]');
		expect(cancel.textContent).toBe("Cancel");
		expect(cancel.getAttribute("type")).toBe("button");
		expect(cancel.getAttribute("popovertarget")).toBe(panel.id);
		expect(cancel.getAttribute("popovertargetaction")).toBe("hide");
		const commit = pick(confirmForm, '[data-test-action="article-version-delete-confirm"]');
		expect(commit.textContent).toBe("Delete version");
		expect(commit.getAttribute("type")).toBe("submit");
		expect(Array.from(confirmForm.querySelectorAll("button"), (button) => button.textContent)).toEqual([
			"Cancel",
			"Delete version",
		]);
	});

	it("puts the delete controls on an older row alone when that is the one the viewer authored", () => {
		const doc = parse(
			renderArticleHistory({
				versions: [
					versionAt("2026-07-10T09:14Z"),
					versionAt("2026-06-28T22:01Z"),
					versionAt("2026-03-26T14:32Z"),
				],
				removal: { authoredMinuteIds: ["2026-06-28T22:01Z"], removeVersionUrl: REMOVE_VERSION_URL },
			}),
		);

		expect(removeControlCounts(doc)).toEqual([
			{ forms: 0, triggers: 0, panels: 0 },
			{ forms: 1, triggers: 1, panels: 1 },
			{ forms: 0, triggers: 0, panels: 0 },
		]);
		const row = pick(doc, '[data-test-article-history-version="2026-06-28T22:01Z"]');
		const date = pick(row, 'time[data-local-time="date"]');
		expect(date.id).toBe("article-history-date-1");
		expect(
			pick(row, "form[data-test-article-history-remove] button").getAttribute("aria-describedby"),
		).toBe("article-history-date-1");
		const trigger = pick(row, '[data-test-action="article-version-delete-open"]');
		expect(trigger.getAttribute("popovertarget")).toBe("article-history-delete-1");
		expect(pick(row, "#article-history-delete-1").getAttribute("data-test-confirm-subject")).toBe(
			"2026-06-28T22:01Z",
		);
		expect(badgeLabels(row)).toEqual([]);
	});

	it("offers no delete control when the viewer authored none of the listed versions", () => {
		const doc = parse(
			renderArticleHistory({
				versions: [versionAt("2026-07-10T09:14Z")],
				removal: { authoredMinuteIds: ["2026-01-01T00:00Z"], removeVersionUrl: REMOVE_VERSION_URL },
			}),
		);

		expect(removeControlCounts(doc)).toEqual([{ forms: 0, triggers: 0, panels: 0 }]);
		expect(badgeLabels(doc)).toEqual(["Current"]);
	});
});

describe("renderOfflineCopyTemplate", () => {
	it("holds one open card whose single row is the stored copy's: Offline where Current sits, its own date id, blank stamps and no delete control", () => {
		const template = JSDOM.fragment(renderOfflineCopyTemplate()).querySelector("template");
		assert(template, "the stored copy's row must ship inside a template");
		expect(template.hasAttribute("data-offline-copy-template")).toBe(true);

		const card = pick(template.content, "details[data-test-article-history]");
		expect(card.hasAttribute("open")).toBe(true);
		expect(pick(card, ".disclosure-card__title").textContent).toBe("Article history");
		expect(card.querySelectorAll("[data-article-history-versions]")).toHaveLength(1);
		expect(rowKeys(card)).toEqual(["offline"]);
		const row = pick(card, '[data-test-article-history-version="offline"]');
		expect(markerClasses(card)).toEqual([CURRENT_MARKER]);
		expect(badgeLabels(row)).toEqual(["Offline"]);
		expect(pick(row, '[data-test-article-history-badge="offline"]').className).toBe(
			"chip chip--badge chip--accent article-history__badge",
		);
		const date = pick(row, 'time[data-local-time="date"]');
		expect(date.id).toBe("article-history-date-offline");
		expect(date.getAttribute("datetime")).toBe("");
		expect(date.textContent).toBe("");
		const time = pick(row, 'time[data-local-time="time"]');
		expect(time.getAttribute("datetime")).toBe("");
		expect(time.textContent).toBe("");
		expect(removeControlCounts(card)).toEqual([{ forms: 0, triggers: 0, panels: 0 }]);
	});
});
