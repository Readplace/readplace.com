import assert from "node:assert/strict";
import { CandidateIdSchema } from "@packages/article-state-types";
import type { Highlight } from "@packages/domain/article";
import { HighlightIdSchema } from "@packages/domain/article";
import { JSDOM } from "jsdom";
import {
	type HighlightsRailInput,
	type HighlightsRailRow,
	highlightsRailRowsFromStates,
	renderHighlightDeleteConfirm,
	renderHighlightsRail,
	storedHighlightsRailRows,
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

function aRow(
	row: Highlight,
	state: HighlightsRailRow["shown"]["state"],
	marked = state === "anchored" || state === "moved",
): HighlightsRailRow {
	return { highlight: row, shown: { state, edited: false, quote: row.exact }, marked };
}

const WEB_SCOPE = { articleId: "abc", readlist: [], surface: [] };

const deleteUrlFor = (highlightId: string): string =>
	`/queue/abc/highlights/${highlightId}/delete?utm_source=highlights-rail&utm_medium=internal&utm_content=delete-highlight`;

const noteUrlFor = (highlightId: string): string =>
	`/queue/abc/highlights/${highlightId}/note?utm_source=highlights-rail&utm_medium=internal&utm_content=edit-note`;

function railOf(
	rows: readonly HighlightsRailRow[],
	oob = false,
	scope: HighlightsRailInput["scope"] = WEB_SCOPE,
	openNote: HighlightsRailInput["openNote"] = undefined,
): Document {
	return new JSDOM(renderHighlightsRail({ rows, scope, openNote, oob }).html)
		.window.document;
}

function rowOf(doc: Document, highlightId: string): Element {
	const row = doc.querySelector(`[data-test-highlight-row="${highlightId}"]`);
	assert(row, `the rail must list ${highlightId}`);
	return row;
}

function rowAndConfirmOf(doc: Document, highlightId: string): Element[] {
	const confirm = doc.getElementById(`delete-highlight-${highlightId}`);
	assert(confirm, `the rail must render the Delete confirm of ${highlightId}`);
	return [rowOf(doc, highlightId), confirm];
}

describe("renderHighlightsRail without a form scope", () => {
	const row = aRow({ ...highlight({ highlightId: FIRST_ID, exact: "first", orderKey: 1 }), note: "kept" }, "anchored");

	it("lists the row, its note and its Jump link with no forms, popovers or note controls", () => {
		const doc = new JSDOM(renderHighlightsRail({ rows: [row], scope: undefined, openNote: undefined, oob: false }).html).window.document;

		const listed = rowOf(doc, FIRST_ID);
		expect(listed.querySelector("[data-test-highlight-note]")?.textContent).toBe("kept");
		expect(listed.querySelector('[data-test-action="highlight-jump"]')?.getAttribute("href")).toBe(`#highlight-${FIRST_ID}`);
		expect(doc.querySelectorAll("form")).toHaveLength(0);
		expect(doc.querySelectorAll("[popover]")).toHaveLength(0);
		expect(doc.querySelectorAll("[popovertarget]")).toHaveLength(0);
		expect(doc.querySelector("[data-test-highlight-note-fallback]")).toBeNull();
	});
});

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

	it("renders each row's dialogs after the collapsible card, so they open while it is collapsed", () => {
		const doc = railOf([aRow(first, "anchored")]);

		const dialogs = Array.from(doc.querySelectorAll("[popover]"));
		expect(dialogs.map((dialog) => dialog.id)).toEqual([`delete-highlight-${FIRST_ID}`, `note-highlight-${FIRST_ID}`]);
		for (const dialog of dialogs) {
			expect(dialog.closest("details")).toBeNull();
			expect(dialog.closest("#highlights-rail")).not.toBeNull();
		}
	});

	it("gives each row its own popover, and each Delete names its own highlight", () => {
		const doc = railOf([
			aRow(first, "anchored"),
			aRow(second, "anchored"),
		]);

		const popoverIds = Array.from(
			doc.querySelectorAll("[popover]"),
			(popover) => popover.id,
		);
		expect(popoverIds).toEqual([
			`delete-highlight-${FIRST_ID}`,
			`note-highlight-${FIRST_ID}`,
			`delete-highlight-${SECOND_ID}`,
			`note-highlight-${SECOND_ID}`,
		]);
		for (const highlightId of [FIRST_ID, SECOND_ID]) {
			const row = rowOf(doc, highlightId);
			expect(
				row
					.querySelector('[data-test-action="highlight-delete"]')
					?.getAttribute("popovertarget"),
			).toBe(`delete-highlight-${highlightId}`);
			const forms = rowAndConfirmOf(doc, highlightId).flatMap((scope) =>
				Array.from(scope.querySelectorAll("form:not([data-test-form])"), (form) => form.getAttribute("action")),
			);
			expect(forms).toHaveLength(2);
			for (const action of forms) {
				assert(action);
				const url = new URL(action, "https://readplace.com");
				expect(url.pathname).toBe(
					`/queue/abc/highlights/${highlightId}/delete`,
				);
				expect(action).toBe(deleteUrlFor(highlightId));
			}
		}
	});

	it("keys the popover as highlight-delete with the highlight as its subject, and focuses Delete", () => {
		const doc = railOf([aRow(first, "anchored")]);

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
		const doc = railOf([aRow(first, "anchored")]);

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
			aRow(second, "anchored"),
			aRow(tied, "anchored"),
			aRow(first, "anchored"),
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
		const row = rowOf(railOf([aRow(first, state)]), FIRST_ID);

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
			railOf([aRow(first, "orphaned")]),
			FIRST_ID,
		);

		expect(row.getAttribute("data-test-highlight-state")).toBe("orphaned");
		expect(row.querySelector("[data-test-highlight-orphan]")?.textContent).toBe(
			"Not found in this version",
		);
		expect(row.querySelector('[data-test-action="highlight-jump"]')).toBeNull();
	});

	it("dates an orphan that records the version it was created on by when it was highlighted", () => {
		const createdOnAVersion: Highlight = {
			...first,
			createdOnCandidateId: CandidateIdSchema.parse("candidate-origin"),
			createdAt: new Date("2026-05-10T09:30:00.000Z"),
		};
		const row = rowOf(railOf([aRow(createdOnAVersion, "orphaned")]), FIRST_ID);

		const highlightedOn = row.querySelector("[data-test-highlight-highlighted-on]");
		assert(highlightedOn, "the orphan must say when it was highlighted");
		expect(highlightedOn.textContent).toBe("Highlighted May 10, 2026");
		const time = highlightedOn.querySelector("time");
		assert(time, "the date must be a localisable <time>");
		expect(time.getAttribute("datetime")).toBe("2026-05-10T09:30:00.000Z");
		expect(time.getAttribute("data-local-time")).toBe("date");
	});

	it("dates neither an orphan with no recorded version nor a placed row that has one", () => {
		const createdOnAVersion: Highlight = {
			...first,
			createdOnCandidateId: CandidateIdSchema.parse("candidate-origin"),
		};
		const doc = railOf([
			aRow(createdOnAVersion, "anchored"),
			aRow({ ...second, orderKey: 20 }, "orphaned"),
		]);

		const childrenOf = (id: string) =>
			[...rowOf(doc, id).children].map((child) => child.className);
		expect(childrenOf(FIRST_ID)).toEqual([
			"highlights-rail__excerpt",
			"highlights-rail__actions",
			"highlight-note__fallback",
		]);
		expect(childrenOf(SECOND_ID)).toEqual([
			"highlights-rail__excerpt",
			"highlights-rail__chip",
			"highlights-rail__actions",
			"highlight-note__fallback",
		]);
	});

	it("shows a pending row's excerpt with neither Jump nor chip", () => {
		const row = rowOf(
			railOf(storedHighlightsRailRows({ rows: [first], canonicalContentHash: "a newer hash" })),
			FIRST_ID,
		);

		expect(row.getAttribute("data-test-highlight-state")).toBe("pending");
		expect(row.querySelector('[data-test-action="highlight-jump"]')).toBeNull();
		expect(row.querySelector("[data-test-highlight-orphan]")).toBeNull();
		expect(row.querySelector(".highlights-rail__excerpt")?.textContent).toBe(
			"First passage",
		);
	});

	it("shows a stored row's own state, with no Jump, while the page has not been marked", () => {
		const row = rowOf(
			railOf(storedHighlightsRailRows({ rows: [first], canonicalContentHash: "hash" })),
			FIRST_ID,
		);

		expect(row.getAttribute("data-test-highlight-state")).toBe("anchored");
		expect(row.querySelector('[data-test-action="highlight-jump"]')).toBeNull();
	});

	it("gives a row Jump only when the page marked it", () => {
		const row = rowOf(railOf([aRow(first, "moved", false)]), FIRST_ID);

		expect(row.getAttribute("data-test-highlight-state")).toBe("moved");
		expect(row.querySelector('[data-test-action="highlight-jump"]')).toBeNull();
	});

	it("shows an edited row's current wording and says what the reader highlighted", () => {
		const row = rowOf(
			railOf([{ highlight: first, shown: { state: "moved", edited: true, quote: "First passage, edited" }, marked: true }]),
			FIRST_ID,
		);

		expect(row.querySelector(".highlights-rail__excerpt")?.textContent).toBe("First passage, edited");
		expect(row.querySelector("[data-test-highlight-edited]")?.textContent).toBe(
			"Edited in this version. You highlighted: “First passage”",
		);
	});

	it("takes each row's state from the stored row and marks it when the page placed it", () => {
		const shown = { state: "moved", edited: false, quote: "First passage" } as const;
		expect(
			highlightsRailRowsFromStates([
				{ highlight: first, place: { start: 4, end: 9 }, shown },
				{ highlight: second, place: undefined, shown },
			]),
		).toEqual([
			{ highlight: first, shown, marked: true },
			{ highlight: second, shown, marked: false },
		]);
	});

	it("renders the empty wrapper and reports no rows when there are none", () => {
		const rendered = renderHighlightsRail({
			rows: [],
			scope: WEB_SCOPE,
			openNote: undefined,
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
			rows: [aRow(first, "anchored")],
			scope: WEB_SCOPE,
			openNote: undefined,
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
			...highlight({
				highlightId: FIRST_ID,
				exact: "First passage",
				orderKey: 10,
			}),
			note: "A line\nand another",
		};

		it("shows a row's note under its quote and offers Edit note, and Add note on a row without one", () => {
			const doc = railOf([
				aRow(noted, "anchored"),
				aRow(second, "anchored"),
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
			expect(trigger?.classList.contains("highlight-note__trigger")).toBe(true);
			const bareRow = rowOf(doc, SECOND_ID);
			expect(
				bareRow.querySelectorAll("[data-test-highlight-note]"),
			).toHaveLength(0);
			expect(
				bareRow.querySelector('[data-test-action="highlight-note"]')
					?.textContent,
			).toBe("Add note");
		});

		it("renders each row's note dialog after the list, titled by its note state", () => {
			const doc = railOf([
				aRow(noted, "anchored"),
				aRow(second, "anchored"),
			]);

			const dialogs = Array.from(
				doc.querySelectorAll(
					'[data-test-confirm-popover="highlight-note-edit"]',
				),
			);
			expect(
				dialogs.map((dialog) =>
					dialog.getAttribute("data-test-confirm-subject"),
				),
			).toEqual([FIRST_ID, SECOND_ID]);
			for (const dialog of dialogs) {
				expect(dialog.closest("ol")).toBeNull();
				expect(dialog.querySelector("form")?.getAttribute("action")).toBe(
					noteUrlFor(dialog.getAttribute("data-test-confirm-subject") ?? ""),
				);
			}
			expect(dialogs[0].textContent).toContain("Edit note");
			expect(dialogs[1].textContent).toContain("Add a note");
		});

		it("offers an orphaned row's note dialog too", () => {
			const doc = railOf([aRow(noted, "orphaned")]);

			expect(
				rowOf(doc, FIRST_ID).querySelector(
					'[data-test-action="highlight-note"]',
				)?.textContent,
			).toBe("Edit note");
			expect(doc.getElementById(`note-highlight-${FIRST_ID}`)).not.toBeNull();
		});

		it("holds each row's fallback form in a details, posting the dialog's action and note field with no autofocus or popover target", () => {
			const doc = railOf([aRow(noted, "anchored")]);

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

		it("opens and focuses only the named row's fallback form", () => {
			const doc = railOf(
				[
					aRow(noted, "anchored"),
					aRow(second, "pending"),
				],
				false,
				WEB_SCOPE,
				SECOND_ID,
			);

			const fallbackOf = (id: string): HTMLDetailsElement => {
				const fallback = rowOf(doc, id).querySelector<HTMLDetailsElement>(
					"details.highlight-note__fallback",
				);
				assert(fallback);
				return fallback;
			};
			expect(fallbackOf(SECOND_ID).open).toBe(true);
			expect(
				fallbackOf(SECOND_ID).querySelector("textarea")?.hasAttribute("autofocus"),
			).toBe(true);
			expect(fallbackOf(FIRST_ID).open).toBe(false);
			expect(doc.querySelectorAll("details.highlight-note__fallback [autofocus]")).toHaveLength(1);
		});

		it("repeats no id across two rows, and each form's label and description resolve inside that form", () => {
			const doc = railOf([
				aRow(noted, "anchored"),
				aRow(second, "anchored"),
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

		function rowActionsOf(doc: Document, highlightId: string): (string | null)[] {
			return Array.from(
				rowOf(doc, highlightId).querySelectorAll(
					".highlights-rail__actions [data-test-action]",
				),
				(action) => action.getAttribute("data-test-action"),
			);
		}

		it("offers Delete note last in a noted row's actions, and not in a row without a note", () => {
			const doc = railOf([
				aRow(noted, "anchored"),
				aRow(second, "anchored"),
			]);

			expect(rowActionsOf(doc, FIRST_ID)).toEqual([
				"highlight-jump",
				"highlight-delete-fallback",
				"highlight-delete",
				"highlight-note",
				"highlight-note-delete",
			]);
			expect(rowActionsOf(doc, SECOND_ID)).toEqual([
				"highlight-jump",
				"highlight-delete-fallback",
				"highlight-delete",
				"highlight-note",
			]);
		});

		it("deletes the note at once from the row, with no popover, and the edit dialog's Delete note submits that same form", () => {
			const doc = railOf([aRow(noted, "anchored")]);

			const rowButton = rowOf(doc, FIRST_ID).querySelector(
				'.highlights-rail__actions [data-test-action="highlight-note-delete"]',
			);
			assert(rowButton);
			expect(rowButton.hasAttribute("popovertarget")).toBe(false);
			const form = rowButton.closest("form");
			assert(form);
			expect(form.getAttribute("action")).toBe(
				`/queue/abc/highlights/${FIRST_ID}/note?utm_source=highlights-rail&utm_medium=internal&utm_content=delete-note`,
			);
			const dialogButton = doc
				.getElementById(`note-highlight-${FIRST_ID}`)
				?.querySelector('[data-test-action="highlight-note-delete"]');
			expect(dialogButton?.getAttribute("form")).toBe(form.id);
		});

		it("disables the edit dialog's Delete note while its form is in flight, as well as the row's", () => {
			const doc = railOf([aRow(noted, "anchored")]);

			const form = doc.getElementById(`delete-note-highlight-${FIRST_ID}`);
			assert(form);
			const [inForm, outsideForm] = (form.getAttribute("hx-disabled-elt") ?? "").split(", ");
			expect(inForm).toBe("find button");
			assert(outsideForm);
			expect(
				Array.from(doc.querySelectorAll(outsideForm), (button) => button.closest("[popover]")?.id),
			).toEqual([`note-highlight-${FIRST_ID}`]);
		});

		it("names the highlight on every Delete highlight control", () => {
			const doc = railOf([aRow(noted, "anchored")]);

			for (const action of [
				"highlight-delete-fallback",
				"highlight-delete",
				"highlight-delete-confirm",
			]) {
				expect(
					rowAndConfirmOf(doc, FIRST_ID)
						.map((scope) => scope.querySelector(`[data-test-action="${action}"]`)?.textContent)
						.filter((text) => text !== undefined),
				).toEqual(["Delete highlight"]);
			}
		});

		it("says in the Delete highlight confirm that the note goes too, only when there is one", () => {
			const doc = railOf([
				aRow(noted, "anchored"),
				aRow(second, "anchored"),
			]);

			expect(
				doc.getElementById(`delete-highlight-${FIRST_ID}`)?.textContent,
			).toContain(
				"The passage stays in the article; your highlight and its note are removed.",
			);
			expect(
				doc.getElementById(`delete-highlight-${SECOND_ID}`)?.textContent,
			).toContain(
				"The passage stays in the article; only your highlight is removed.",
			);
		});

		it("keeps the readlist and surface on Delete note in the app, and stops it pushing history", () => {
			const doc = railOf([aRow(noted, "anchored")], false, {
				articleId: "abc",
				readlist: [["queue", "work"]],
				surface: [["platform", "ios"]],
			});

			const form = doc.getElementById(`delete-note-highlight-${FIRST_ID}`);
			expect(
				new URL(form?.getAttribute("action") ?? "", "https://readplace.com")
					.search,
			).toBe(
				"?queue=work&platform=ios&utm_source=highlights-rail&utm_medium=internal&utm_content=delete-note",
			);
			expect(form?.getAttribute("hx-push-url")).toBe("false");
		});

		it("repeats no id across two noted rows", () => {
			const doc = railOf([
				aRow(noted, "anchored"),
				aRow({ ...second, note: "another" }, "anchored"),
			]);

			const ids = Array.from(doc.querySelectorAll("[id]"), (el) => el.id);
			expect(new Set(ids).size).toBe(ids.length);
		});

		it("escapes a stored note", () => {
			const doc = railOf([
				aRow({ ...noted, note: "<img src=x>" }, "anchored"),
			]);

			expect(
				rowOf(doc, FIRST_ID).querySelector("[data-test-highlight-note]")
					?.innerHTML,
			).toBe("&lt;img src=x&gt;");
		});
	});

	describe("in the app surface", () => {
		const doc = railOf([aRow(first, "anchored")], false, {
			articleId: "abc",
			readlist: [["queue", "work"]],
			surface: [["platform", "ios"]],
		});

		it("posts every form with the readlist, then the surface", () => {
			const actions = rowAndConfirmOf(doc, FIRST_ID).flatMap((scope) =>
				Array.from(
					scope.querySelectorAll("form"),
					(form) => new URL(form.getAttribute("action") ?? "", "https://readplace.com").search,
				),
			);

			expect(actions).toHaveLength(3);
			for (const search of actions) {
				expect(search).toMatch(
					/^\?queue=work&platform=ios&utm_source=highlights-rail/,
				);
			}
		});

		it("stops every boosted delete and note form from pushing history", () => {
			const forms = Array.from(doc.querySelectorAll("form[hx-boost]"));

			expect(forms).toHaveLength(4);
			for (const form of forms) {
				expect(form.getAttribute("hx-push-url")).toBe("false");
			}
		});

		it("keeps Jump an in-page fragment with no query", () => {
			expect(
				doc
					.querySelector('[data-test-action="highlight-jump"]')
					?.getAttribute("href"),
			).toBe(`#highlight-${FIRST_ID}`);
		});
	});

	it("lets the web reader's boosted forms push history", () => {
		const doc = railOf([aRow(first, "anchored")]);

		expect(doc.querySelectorAll("form[hx-boost]")).toHaveLength(4);
		expect(doc.querySelectorAll("[hx-push-url]")).toHaveLength(0);
		expect(
			doc
				.querySelector('[data-test-action="highlight-jump"]')
				?.getAttribute("href"),
		).toBe(`#highlight-${FIRST_ID}`);
	});
});

describe("renderHighlightDeleteConfirm", () => {
	function confirmOf(html: string): Element {
		const panel = new JSDOM(html).window.document.getElementById(`delete-highlight-${FIRST_ID}`);
		assert(panel);
		return panel;
	}

	it("posts the delete to the server for a server target, naming the note when there is one", () => {
		const panel = confirmOf(
			renderHighlightDeleteConfirm({
				highlightId: FIRST_ID,
				note: "A note",
				target: { kind: "server", scope: WEB_SCOPE },
			}),
		);
		const form = panel.querySelector("form");

		assert.equal(panel.getAttribute("data-test-confirm-popover"), "highlight-delete");
		assert.equal(panel.getAttribute("data-test-confirm-subject"), FIRST_ID);
		assert.equal(form?.getAttribute("method"), "POST");
		assert.equal(form?.getAttribute("action"), deleteUrlFor(FIRST_ID));
		assert.equal(form?.hasAttribute("data-highlight-local"), false);
		assert.match(panel.textContent ?? "", /note/i);
	});

	it("deletes in the browser for a local target, through a dialog form naming the highlight", () => {
		const panel = confirmOf(
			renderHighlightDeleteConfirm({ highlightId: FIRST_ID, note: undefined, target: { kind: "local" } }),
		);
		const form = panel.querySelector("form");
		assert(form);

		assert.equal(form.getAttribute("method"), "dialog");
		assert.equal(form.getAttribute("data-highlight-local"), "delete");
		assert.equal(form.getAttribute("data-highlight-local-id"), FIRST_ID);
		assert.equal(form.hasAttribute("action"), false);
		assert.equal(form.hasAttribute("hx-boost"), false);
		const button = form.querySelector('[data-test-action="highlight-delete-confirm"]');
		assert.equal(button?.textContent, "Delete highlight");
		assert.equal(button?.hasAttribute("autofocus"), true);
	});
});
