import assert from "node:assert/strict";
import type { Highlight } from "@packages/domain/article";
import { HighlightIdSchema } from "@packages/domain/article";
import { JSDOM } from "jsdom";
import {
	type HighlightsRailRow,
	highlightsRailRowsFromStates,
	pendingHighlightsRailRows,
	renderHighlightsRail,
} from "./highlights-rail.component";

const FIRST_ID = HighlightIdSchema.parse(
	"11111111-1111-4111-8111-111111111111",
);
const SECOND_ID = HighlightIdSchema.parse(
	"22222222-2222-4222-8222-222222222222",
);
const THIRD_ID = HighlightIdSchema.parse(
	"33333333-3333-4333-8333-333333333333",
);

function highlight(input: {
	highlightId: Highlight["highlightId"];
	exact: string;
	orderKey: number;
}): Highlight {
	return {
		highlightId: input.highlightId,
		highlightOf: "https://example.com/article",
		exact: input.exact,
		prefix: "",
		suffix: "",
		start: 0,
		end: input.exact.length,
		anchoredContentHash: "hash",
		anchorState: "anchored",
		orderKey: input.orderKey,
		createdAt: new Date("2026-11-01T00:00:00.000Z"),
		updatedAt: new Date("2026-11-01T00:00:00.000Z"),
		anchorRevision: 0,
	};
}

const deleteUrlFor = (highlightId: string): string =>
	`/queue/abc/highlights/${highlightId}/delete?feature=highlight`;

const noteUrlFor = (highlightId: string): string =>
	`/queue/abc/highlights/${highlightId}/note?feature=highlight`;

function railOf(rows: readonly HighlightsRailRow[], oob = false): Document {
	return new JSDOM(
		renderHighlightsRail({ rows, deleteUrlFor, noteUrlFor, oob }).html,
	).window.document;
}

function rowOf(doc: Document, highlightId: string): Element {
	const row = doc.querySelector(`[data-test-highlight-row="${highlightId}"]`);
	assert(row, `the rail must list ${highlightId}`);
	return row;
}

describe("renderHighlightsRail", () => {
	const first = highlight({
		highlightId: FIRST_ID,
		exact: "First passage",
		orderKey: 10,
	});
	const second = highlight({
		highlightId: SECOND_ID,
		exact: "Second passage",
		orderKey: 20,
	});

	it("gives each row its own popover, and each Delete names its own highlight", () => {
		const doc = railOf([
			{ highlight: first, state: "anchored" },
			{ highlight: second, state: "anchored" },
		]);

		const popoverIds = Array.from(
			doc.querySelectorAll("[popover]"),
			(popover) => popover.id,
		);
		expect(popoverIds).toEqual([
			`delete-highlight-${FIRST_ID}`,
			`delete-highlight-${SECOND_ID}`,
			`note-highlight-${FIRST_ID}`,
			`note-highlight-${SECOND_ID}`,
		]);
		for (const highlightId of [FIRST_ID, SECOND_ID]) {
			const row = rowOf(doc, highlightId);
			expect(
				row
					.querySelector('[data-test-action="highlight-delete"]')
					?.getAttribute("popovertarget"),
			).toBe(`delete-highlight-${highlightId}`);
			const forms = Array.from(
				row.querySelectorAll("form:not([data-test-form])"),
				(form) => form.getAttribute("action"),
			);
			expect(forms).toHaveLength(2);
			for (const action of forms) {
				assert(action);
				const url = new URL(action, "https://readplace.com");
				expect(url.pathname).toBe(
					`/queue/abc/highlights/${highlightId}/delete`,
				);
				expect(url.searchParams.get("feature")).toBe("highlight");
				expect(action).toBe(deleteUrlFor(highlightId));
			}
		}
	});

	it("keys the popover as highlight-delete with the highlight as its subject, and focuses Delete", () => {
		const doc = railOf([{ highlight: first, state: "anchored" }]);

		const popover = doc.getElementById(`delete-highlight-${FIRST_ID}`);
		assert(popover);
		expect(popover.outerHTML).toContain("highlight-delete");
		expect(popover.outerHTML).toContain(FIRST_ID);
		expect(
			popover
				.querySelector('[data-test-action="highlight-delete-confirm"]')
				?.hasAttribute("autofocus"),
		).toBe(true);
	});

	it("swaps <main> from both delete forms with their buttons disabled in flight", () => {
		const doc = railOf([{ highlight: first, state: "anchored" }]);

		for (const form of Array.from(
			doc.querySelectorAll("form:not([data-test-form])"),
		)) {
			expect(form.getAttribute("hx-boost")).toBe("true");
			expect(form.getAttribute("hx-target")).toBe("main");
			expect(form.getAttribute("hx-select")).toBe("main");
			expect(form.getAttribute("hx-swap")).toBe("outerHTML show:none");
			expect(form.getAttribute("hx-disabled-elt")).toBe("find button");
		}
	});

	it("lists rows in orderKey order, then by id, whatever order they arrive in", () => {
		const tied = highlight({
			highlightId: THIRD_ID,
			exact: "Tied passage",
			orderKey: 10,
		});
		const doc = railOf([
			{ highlight: second, state: "anchored" },
			{ highlight: tied, state: "anchored" },
			{ highlight: first, state: "anchored" },
		]);

		expect(
			Array.from(doc.querySelectorAll("[data-highlight-row]"), (row) =>
				row.getAttribute("data-highlight-row"),
			),
		).toEqual([FIRST_ID, THIRD_ID, SECOND_ID]);
	});

	it.each([
		"anchored",
		"moved",
	] as const)("links a %s row's Jump to its mark", (state) => {
		const row = rowOf(railOf([{ highlight: first, state }]), FIRST_ID);

		expect(row.getAttribute("data-test-highlight-state")).toBe(state);
		expect(
			row
				.querySelector('[data-test-action="highlight-jump"]')
				?.getAttribute("href"),
		).toBe(`#highlight-${FIRST_ID}`);
		expect(row.querySelector("[data-test-highlight-orphan]")).toBeNull();
		expect(row.querySelector(".highlights-rail__excerpt")?.textContent).toBe(
			"First passage",
		);
	});

	it("shows an orphan's chip and no Jump", () => {
		const row = rowOf(
			railOf([{ highlight: first, state: "orphaned" }]),
			FIRST_ID,
		);

		expect(row.getAttribute("data-test-highlight-state")).toBe("orphaned");
		expect(row.querySelector("[data-test-highlight-orphan]")?.textContent).toBe(
			"Not found in this version",
		);
		expect(row.querySelector('[data-test-action="highlight-jump"]')).toBeNull();
	});

	it("shows a pending row's excerpt with neither Jump nor chip", () => {
		const row = rowOf(railOf(pendingHighlightsRailRows([first])), FIRST_ID);

		expect(row.getAttribute("data-test-highlight-state")).toBe("pending");
		expect(row.querySelector('[data-test-action="highlight-jump"]')).toBeNull();
		expect(row.querySelector("[data-test-highlight-orphan]")).toBeNull();
		expect(row.querySelector(".highlights-rail__excerpt")?.textContent).toBe(
			"First passage",
		);
	});

	it("takes each row's state from its anchor", () => {
		expect(
			highlightsRailRowsFromStates([
				{
					highlight: first,
					anchor: { start: 4, end: 9, anchorState: "moved" },
				},
			]),
		).toEqual([{ highlight: first, state: "moved" }]);
	});

	it("renders the empty wrapper and reports no rows when there are none", () => {
		const rendered = renderHighlightsRail({
			rows: [],
			deleteUrlFor,
			noteUrlFor,
			oob: false,
		});
		const wrapper = new JSDOM(rendered.html).window.document.querySelector(
			"[data-test-highlights-rail]",
		);

		expect(rendered.hasRows).toBe(false);
		assert(wrapper);
		expect(wrapper.id).toBe("highlights-rail");
		expect(wrapper.children).toHaveLength(0);
		expect(wrapper.hasAttribute("hx-swap-oob")).toBe(false);
	});

	it("reports rows and swaps out of band when asked", () => {
		const rendered = renderHighlightsRail({
			rows: [{ highlight: first, state: "anchored" }],
			deleteUrlFor,
			noteUrlFor,
			oob: true,
		});
		const wrapper = new JSDOM(rendered.html).window.document.getElementById(
			"highlights-rail",
		);

		expect(rendered.hasRows).toBe(true);
		expect(wrapper?.getAttribute("hx-swap-oob")).toBe("outerHTML");
	});

	describe("notes", () => {
		const noted = {
			...highlight({ highlightId: FIRST_ID, exact: "First passage", orderKey: 10 }),
			note: "A line\nand another",
		};

		it("shows a row's note under its quote and offers Edit note, and Add note on a row without one", () => {
			const doc = railOf([
				{ highlight: noted, state: "anchored" },
				{ highlight: second, state: "anchored" },
			]);

			const notedRow = rowOf(doc, FIRST_ID);
			expect(
				notedRow.querySelector("[data-test-highlight-note]")?.textContent,
			).toBe("A line\nand another");
			expect(
				notedRow.querySelector("blockquote + [data-test-highlight-note]"),
			).not.toBeNull();
			const trigger = notedRow.querySelector(
				'[data-test-action="highlight-note"]',
			);
			expect(trigger?.textContent).toBe("Edit note");
			expect(trigger?.getAttribute("popovertarget")).toBe(
				`note-highlight-${FIRST_ID}`,
			);
			expect(trigger?.classList.contains("highlight-note__trigger")).toBe(
				true,
			);
			const bareRow = rowOf(doc, SECOND_ID);
			expect(bareRow.querySelectorAll("[data-test-highlight-note]")).toHaveLength(
				0,
			);
			expect(
				bareRow.querySelector('[data-test-action="highlight-note"]')
					?.textContent,
			).toBe("Add note");
		});

		it("renders each row's note dialog after the list, titled by its note state", () => {
			const doc = railOf([
				{ highlight: noted, state: "anchored" },
				{ highlight: second, state: "anchored" },
			]);

			const dialogs = Array.from(
				doc.querySelectorAll('[data-test-confirm-popover="highlight-note-edit"]'),
			);
			expect(
				dialogs.map((dialog) =>
					dialog.getAttribute("data-test-confirm-subject"),
				),
			).toEqual([FIRST_ID, SECOND_ID]);
			for (const dialog of dialogs) {
				expect(dialog.closest("ol")).toBeNull();
				expect(
					dialog.querySelector("form")?.getAttribute("action"),
				).toBe(noteUrlFor(dialog.getAttribute("data-test-confirm-subject") ?? ""));
			}
			expect(dialogs[0].textContent).toContain("Edit note");
			expect(dialogs[1].textContent).toContain("Add a note");
		});

		it("offers an orphaned row's note dialog too", () => {
			const doc = railOf([{ highlight: noted, state: "orphaned" }]);

			expect(
				rowOf(doc, FIRST_ID).querySelector('[data-test-action="highlight-note"]')
					?.textContent,
			).toBe("Edit note");
			expect(doc.getElementById(`note-highlight-${FIRST_ID}`)).not.toBeNull();
		});

		it("holds each row's fallback form in a details, posting the dialog's action and note field with no autofocus or popover target", () => {
			const doc = railOf([{ highlight: noted, state: "anchored" }]);

			const fallback = rowOf(doc, FIRST_ID).querySelector(
				"details.highlight-note__fallback",
			);
			assert(fallback);
			expect(fallback.querySelector("summary")?.textContent).toBe("Edit note");
			const form = fallback.querySelector(
				'form[data-test-form="highlight-note-fallback"]',
			);
			assert(form);
			expect(form.getAttribute("action")).toBe(noteUrlFor(FIRST_ID));
			expect(form.querySelector("textarea")?.getAttribute("name")).toBe("note");
			expect(form.querySelector("textarea")?.textContent).toBe(
				"A line\nand another",
			);
			expect(form.querySelectorAll("[autofocus]")).toHaveLength(0);
			expect(form.querySelectorAll("[popovertarget]")).toHaveLength(0);
		});

		it("repeats no id across two rows, and each form's label and description resolve inside that form", () => {
			const doc = railOf([
				{ highlight: noted, state: "anchored" },
				{ highlight: second, state: "anchored" },
			]);

			const ids = Array.from(doc.querySelectorAll("[id]"), (el) => el.id);
			expect(new Set(ids).size).toBe(ids.length);
			const forms = Array.from(doc.querySelectorAll("form[data-test-form]"));
			expect(forms).toHaveLength(4);
			for (const form of forms) {
				const label = form.querySelector("label[for]");
				const textarea = form.querySelector("textarea");
				assert(label && textarea);
				expect(form.querySelector(`#${label.getAttribute("for")}`)).toBe(
					textarea,
				);
				expect(
					form.querySelector(`#${textarea.getAttribute("aria-describedby")}`),
				).not.toBeNull();
			}
		});

		it("escapes a stored note", () => {
			const doc = railOf([
				{ highlight: { ...noted, note: "<img src=x>" }, state: "anchored" },
			]);

			expect(
				rowOf(doc, FIRST_ID).querySelector("[data-test-highlight-note]")
					?.innerHTML,
			).toBe("&lt;img src=x&gt;");
		});
	});
});
