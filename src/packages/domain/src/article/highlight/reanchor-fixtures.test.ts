import assert from "node:assert/strict";
import {
	type CandidateId,
	CandidateIdSchema,
} from "@packages/article-state-types";
import { anchorHighlightFuzzy } from "./anchor-highlight-fuzzy";
import { highlightOnPage } from "./highlight-on-page";
import {
	type HighlightAnchorUpdate,
	type ReanchorableHighlight,
	type ReanchorCounts,
	reanchorArticleHighlights,
} from "./reanchor-article-highlights";
import { storedHighlightState } from "./stored-highlight-state";
import { describeRange, normaliseText, type TextRange } from "./text-anchoring";
import { createWordIndex } from "./word-index";

type Row = ReanchorableHighlight;

interface Step {
	anchor: HighlightAnchorUpdate;
	counts: ReanchorCounts;
	served: string | null;
	row: Row;
}

const texts = new Map<CandidateId, string>();
let nextCandidate = 0;

function candidateFor(text: string): CandidateId {
	const id = CandidateIdSchema.parse(`c${nextCandidate++}`);
	texts.set(id, text);
	return id;
}

function unknownCandidate(): CandidateId {
	return CandidateIdSchema.parse(`gone${nextCandidate++}`);
}

function textOf(paras: readonly string[]): string {
	return normaliseText(
		paras.map((text) => ({ text, blockBoundaryBefore: true })),
	).text;
}

function rowAt(text: string, start: number, quote: string): Row {
	assert.ok(start >= 0, `"${quote}" must be in the text`);
	return {
		...describeRange({ text, start, end: start + quote.length }),
		basisCandidateId: candidateFor(text),
		anchoredContentHash: "h0",
		anchorState: "anchored",
		orderKey: start,
		anchorRevision: 1,
	};
}

function mk(paras: readonly string[], quote: string): Row {
	const t0 = textOf(paras);
	return rowAt(t0, t0.indexOf(quote), quote);
}

function mkLast(paras: readonly string[], quote: string): Row {
	const t0 = textOf(paras);
	return rowAt(t0, t0.lastIndexOf(quote), quote);
}

function bare(row: Row): Row {
	const { basisCandidateId: _basis, ...kept } = row;
	return kept;
}

function rerender(row: Row, paras: readonly string[]): Row {
	return { ...row, basisCandidateId: candidateFor(textOf(paras)) };
}

function applyWrite(row: Row, anchor: HighlightAnchorUpdate): Row {
	const {
		anchoredCandidateId: _anchored,
		basisCandidateId: _basis,
		basisQuote: _quote,
		...kept
	} = row;
	return { ...kept, ...anchor, anchorRevision: row.anchorRevision + 1 };
}

function step(
	row: Row,
	paras: readonly string[],
	hash: string,
	body?: readonly string[],
): Step {
	const t = textOf(paras);
	const anchorTexts = new Map<CandidateId, string>();
	const basisText =
		row.basisCandidateId === undefined
			? undefined
			: texts.get(row.basisCandidateId);
	if (row.basisCandidateId !== undefined && basisText !== undefined)
		anchorTexts.set(row.basisCandidateId, basisText);
	let input = row;
	if (body !== undefined) {
		const bodyText = textOf(body);
		const bodyId = candidateFor(bodyText);
		anchorTexts.set(bodyId, bodyText);
		input = { ...row, anchoredCandidateId: bodyId };
	}
	const { writes, counts } = reanchorArticleHighlights({
		text: t,
		contentHash: hash,
		candidateId: candidateFor(t),
		highlights: [input],
		anchorTexts,
	});
	const write = writes[0];
	assert.ok(write, "the row is written");
	const anchor = write.anchor;
	return {
		anchor,
		counts,
		served:
			anchor.anchorState === "orphaned"
				? null
				: t.slice(anchor.start, anchor.end),
		row: applyWrite(input, anchor),
	};
}

function todayStep(row: Row, paras: readonly string[], hash: string): Row {
	const t = textOf(paras);
	const a = anchorHighlightFuzzy({
		text: t,
		contentHash: hash,
		highlight: row,
	});
	const { basisCandidateId: _basis, basisQuote: _quote, ...kept } = row;
	return {
		...kept,
		start: a.start,
		end: a.end,
		anchorState: a.anchorState,
		anchoredContentHash: hash,
		orderKey: a.anchorState === "orphaned" ? row.orderKey : a.start,
		anchorRevision: row.anchorRevision + 1,
	};
}

function onPage(t: string, row: Row, hash: string): TextRange | null {
	return (
		highlightOnPage({ text: t, contentHash: hash, highlight: row }) ?? null
	);
}

function storedState(row: Row, hash: string | undefined) {
	return storedHighlightState({ highlight: row, contentHash: hash });
}

function storedEdited(row: Row): boolean {
	return storedState(row, undefined).edited;
}

function levelOf(x: Step): "missing" | "diff" | "today" {
	if (x.counts.basisMissing > 0) return "missing";
	return x.counts.diffed > 0 ? "diff" : "today";
}

function check(x: Step, want: string | null): Step {
	assert.equal(x.served, want);
	return x;
}

function checkAt(x: Step, want: string | null, at: number | null): Step {
	assert.equal(x.served, want);
	if (want !== null) assert.equal(x.anchor.start, at);
	return x;
}

function slice(t: string, p: TextRange | null): string | null {
	return p === null ? null : t.slice(p.start, p.end);
}

const I = "Intro here.";
const O = "Outro here.";
const CAP = "Table 1 stacked caption";
const END = "A closing line.";
const S0 =
	"The tower is the most photographed structure in the whole city, and visitors queue for hours.";
const Q0 = "most photographed structure in the whole city";
const S1 =
	"The tower is the most admired landmark in the whole city, and visitors queue for hours.";
const S2 =
	"The tower is the most admired structure in the whole city, and visitors queue for hours.";

describe("re-anchoring fixtures", () => {
	describe("R1, a renderer change between versions", () => {
		it("B0", () => {
			const r0 = mk([I, S0, O], Q0);
			check(
				step(rerender(r0, [I, CAP, S0, O]), [I, CAP, S0, O, END], "h2"),
				Q0,
			);
		});
		it("B1", () => {
			const v1 = step(mk([I, S0, O], Q0), [I, S1, O], "h1");
			check(
				step(rerender(v1.row, [I, CAP, S1, O]), [I, CAP, S1, O, END], "h2"),
				"most admired landmark in the whole city",
			);
		});
		it("B2", () => {
			const v1 = step(mk([I, S0, O], Q0), [I, S2, O], "h1");
			check(
				step(rerender(v1.row, [I, CAP, S2, O]), [I, CAP, S2, O, S0], "h2"),
				"most admired structure in the whole city",
			);
		});
	});

	describe("R8, a sentence rewritten around shared function words", () => {
		for (const [id, before, after, quote] of [
			[
				"C1",
				"The cat sat on the mat all day.",
				"The dog ran across the field quickly.",
				"the mat",
			],
			[
				"C2",
				"It was the best of times in the city.",
				"Nobody knew the end of it.",
				"the best of times",
			],
			[
				"C3",
				"Prices rose in the north of England.",
				"Rain fell in the hills of Wales.",
				"in the north",
			],
			[
				"D10",
				"Revenue grew in the quarter.",
				"Costs fell in the year.",
				"the quarter",
			],
			[
				"Q1",
				'He said "The cat sat on the mat all day." She laughed at it for a long while after that.',
				'He said "The dog ran across the field quickly." She laughed at it for a long while after that.',
				"the mat",
			],
			[
				"Q1u",
				"He said The cat sat on the mat all day. She laughed at it for a long while after that.",
				"He said The dog ran across the field quickly. She laughed at it for a long while after that.",
				"the mat",
			],
			[
				"Q2",
				"Prices rose in the north of England.” Analysts said the figures would be revised next month.",
				"Rain fell in the hills of Wales.” Analysts said the figures would be revised next month.",
				"in the north",
			],
			[
				"Q2u",
				"Prices rose in the north of England. Analysts said the figures would be revised next month.",
				"Rain fell in the hills of Wales. Analysts said the figures would be revised next month.",
				"in the north",
			],
		] as const) {
			it(id, () => {
				check(step(mk([I, before, O], quote), [I, after, O], "h1"), null);
			});
		}
		const d9 = () => {
			const v1 = step(
				mk([I, "The cat sat on the mat all day.", O], "the mat"),
				[I, O],
				"h1",
			);
			return {
				v1,
				v2: step(v1.row, [I, "The dog lay near the door at night.", O], "h2"),
			};
		};
		it("D9.1", () => {
			check(d9().v1, null);
		});
		it("D9.2", () => {
			check(d9().v2, null);
		});
		const NW = "Next week the city council will vote on the budget.";
		const LY = "Last year the school board voted on the budget.";
		const WM = "Weather was mild all week.";
		const TL = "Traffic was light on the roads.";
		const DQ = "the city council will vote on the budget";
		for (const [id, before, after] of [
			["D4", [I, NW, WM, TL, O], [I, WM, TL, LY, O]],
			["D1", [I, NW, O], [I, LY, O]],
		] as const) {
			it(id, () => {
				check(step(mk(before, DQ), after, "h1"), null);
			});
		}
	});

	const A =
		"The town held its annual meeting on Monday night. Residents filled the old hall.";
	const Bp =
		"The council voted to approve the new harbour plan. Work on the pier starts in spring.";
	const C =
		"Shop owners asked for more parking near the market. The mayor promised a study.";
	const Dp =
		"Schools will close early on Friday for the festival. Buses run a holiday timetable.";
	const E =
		"The evening ended with thanks to the volunteers. Tea was served afterwards.";

	describe("R3, paragraphs that moved", () => {
		const HQ = "council voted to approve the new harbour plan";
		for (const [id, order] of [
			["H4a", [A, C, Bp, Dp, E]],
			["H4b", [A, C, Dp, E, Bp]],
			["H4c", [Bp, A, C, Dp, E]],
			["H4d", [Dp, A, Bp, C, E]],
		] as const) {
			it(id, () => {
				check(step(mk([A, Bp, C, Dp, E], HQ), order, "h1"), HQ);
			});
		}
		it("D3", () => {
			const P1 = "Quote para is about the harbour lights at dusk.";
			const P = [
				P1,
				"Second para covers the market.",
				"Third para notes the weather.",
				"Fourth para ends the story.",
			];
			check(
				step(mk(P, "the harbour lights at dusk"), [P[1], P[2], P[3], P1], "h1"),
				"the harbour lights at dusk",
			);
		});
	});

	describe("R7 and R8, typo fixes and one-word edits", () => {
		for (const [id, before, after, quote, want] of [
			[
				"C4",
				"The capital is Pariss today.",
				"The capital is Paris today.",
				"Pariss",
				"Paris",
			],
			[
				"K1",
				"We moved the cluster to Kubernettes last year.",
				"We moved the cluster to Kubernetes last year.",
				"Kubernettes",
				"Kubernetes",
			],
			[
				"T2",
				"A recieved pakage arrived.",
				"A received package arrived.",
				"recieved pakage",
				"received package",
			],
			[
				"T3",
				"The commitee recieved the report.",
				"The committee received the report.",
				"commitee recieved",
				"committee received",
			],
			[
				"T5",
				"The commitee met today.",
				"The committee met today.",
				"commitee met today",
				"committee met today",
			],
			[
				"T1",
				"He said teh quikc fox ran.",
				"He said the quick fox ran.",
				"teh quikc fox",
				null,
			],
			[
				"T4",
				"We planted the tree yesterday.",
				"We planted the trees yesterday.",
				"tree",
				"trees",
			],
			[
				"N1",
				"The build is now ready.",
				"The build is not ready.",
				"now ready",
				"not ready",
			],
			[
				"T7",
				"They do not agree.",
				"They don't agree.",
				"do not agree",
				"don't agree",
			],
			[
				"E1",
				"The US economy grew last year.",
				"The U.S. economy grew last year.",
				"US economy grew",
				"U.S. economy grew",
			],
			[
				"E2",
				"Send an email to the office today.",
				"Send an e-mail to the office today.",
				"email to the office",
				"e-mail to the office",
			],
			[
				"E4",
				"The firm hired 1000 new workers.",
				"The firm hired 1,000 new workers.",
				"1000 new workers",
				"1,000 new workers",
			],
		] as const) {
			it(id, () => {
				check(step(mk([I, before, O], quote), [I, after, O], "h1"), want);
			});
		}
		it("M2a", () => {
			const r0 = mk([I, "We won the cup 🎉🎉 at last.", O], "🎉🎉");
			check(
				step(r0, ["A new intro.", "We won the cup 🎉🎉 at last.", O], "h1"),
				"🎉🎉",
			);
		});
		it("M2b", () => {
			const r0 = mk([I, "Wait!!! he said.", O], "!!!");
			check(step(r0, ["A new intro.", "Wait!!! he said.", O], "h1"), "!!!");
		});
	});

	it("M1", () => {
		const v1 = step(mk([I, S0, O], Q0), [I, S2, O], "h1");
		const v2 = step(v1.row, [I, O], "h2");
		assert.equal(storedEdited(v1.row), true);
		assert.equal(storedEdited(v2.row), false);
		assert.equal(v2.row.anchorState, "orphaned");
	});

	it("BG1", () => {
		const v1 = step(mk([I, S0, O], Q0), [I, S2, O], "h1");
		const v2 = step(
			{ ...v1.row, basisCandidateId: unknownCandidate() },
			[I, S1, END, O],
			"h2",
		);
		const words =
			v2.served === null || v2.served === Q0 ? undefined : v2.served;
		assert.equal(levelOf(v2), "missing");
		assert.equal(v2.row.basisQuote, words);
		assert.equal(v2.row.basisCandidateId, undefined);
	});

	describe("R11, the page at the same hash after a renderer deploy", () => {
		const GB =
			"A guidebook once called it the most photographed structure in the whole city.";
		for (const [id, paras, want] of [
			["PG1", [I, CAP, S2, GB, O], "most admired structure in the whole city"],
			["PG2", [I, CAP, GB, O], null],
		] as const) {
			it(id, () => {
				const v1 = step(mk([I, S0, O], Q0), [I, S2, GB, O], "h1");
				const t = textOf(paras);
				const p = onPage(t, v1.row, "h1");
				if (want === null) {
					assert.equal(p, null);
					return;
				}
				assert.ok(p !== null);
				assert.equal(p.start, t.indexOf(S2) + S2.indexOf(want));
				assert.equal(slice(t, p), want);
			});
		}
		const pg3 = () => {
			const r0 = mk([I, S0, O], Q0);
			const t = textOf([I, CAP, S0, O]);
			return { r0, t, p: onPage(t, r0, "h0") };
		};
		it("PG3", () => {
			const { t, p } = pg3();
			assert.ok(p !== null);
			assert.equal(p.start, t.indexOf(S0) + S0.indexOf(Q0));
		});
		it("MG1", () => {
			const { r0, t, p } = pg3();
			const sel = {
				start: t.indexOf("stacked caption"),
				end: t.indexOf("stacked caption") + 15,
			};
			const touches = (x: TextRange | null) =>
				x !== null && x.start <= sel.end && sel.start <= x.end;
			assert.equal(touches(p), false);
			assert.equal(touches({ start: r0.start, end: r0.end }), true);
		});
	});

	const NB = "In the north the old bridge was closed for repairs in autumn.";
	const SB = "Down south the old bridge carried trains until the flood came.";
	const BQ = "the old bridge";
	const XB = "harbour market opened early that spring morning and traders";
	const CB = "A closing note was added here.";

	it("PS3", () => {
		const r0 = mkLast([NB, SB], BQ);
		const re = ["By our correspondent", NB, SB];
		checkAt(step(rerender(r0, re), [...re, CB], "h1"), BQ, 94);
	});

	describe("S1 and D1, a row today's handler placed holds no basis", () => {
		for (const [id, make, v1p, v2p] of [
			["H1i", () => mk([NB, SB], BQ), [XB, NB, SB], [XB, NB, SB, CB]],
			["H1d", () => mkLast([XB, NB, SB], BQ), [NB, SB], [NB, SB, CB]],
		] as const) {
			it(id, () => {
				const s1 = todayStep(make(), v1p, "h1");
				const x = checkAt(step(s1, v2p, "h2", v1p), BQ, 73);
				assert.equal(levelOf(x), "diff");
				assert.notEqual(x.row.basisCandidateId, undefined);
			});
		}
	});

	describe("S2, a row with no basis is drawn by today's page line", () => {
		for (const [id, before, after, quote, want, at] of [
			[
				"H2a",
				"Yesterday the quick brown fox jumps over the lazy dog near the old river bank.",
				"Yesterday the quick brown fox leaps over the lazy dog near the old river bank.",
				"quick brown fox jumps over the lazy dog",
				"quick brown fox leaps over the lazy dog",
				14,
			],
			[
				"H2b",
				"They crossed the slender steel bridge at dawn and kept walking north.",
				"They crossed the slender stele bridge at dawn and kept walking north.",
				"the slender steel bridge",
				"the slender stele bridge",
				13,
			],
		] as const) {
			for (const kind of ["own", "window"] as const) {
				it(`${id}.${kind}`, () => {
					const r0 = bare(mk([before], quote));
					const t = textOf([after]);
					const row = kind === "own" ? todayStep(r0, [after], "h1") : r0;
					const p = onPage(t, row, "h1");
					assert.ok(p !== null);
					assert.equal(p.start, at);
					assert.equal(slice(t, p), want);
					assert.equal(storedState(row, "h1").edited, false);
				});
			}
		}
	});

	describe("R8, function words and near-spellings at exactly half", () => {
		for (const [id, before, after, quote, want] of [
			[
				"SW1",
				"Second para with the end of it.",
				"A completely different para about the weather and of it the end.",
				"the end of it",
				null,
			],
			[
				"SW3",
				"It was the best of times.",
				"It was the worst of times.",
				"the best",
				"the worst",
			],
			[
				"SW5",
				"Prices rose sharply in the north.",
				"Prices rose slightly in the north.",
				"rose sharply",
				"rose slightly",
			],
		] as const) {
			it(id, () => {
				check(step(mk([I, before, O], quote), [I, after, O], "h1"), want);
			});
		}
		for (const [id, before, later, quote] of [
			[
				"SW2",
				"Prices rose sharply in the north.",
				"Profits rose slightly in the south.",
				"rose sharply",
			],
			[
				"SW4",
				"The council approved the new library budget on Monday.",
				"The council rejected the new parking plan on Friday.",
				"approved the new library budget",
			],
		] as const) {
			const chain = () => {
				const v1 = step(mk([I, before, O], quote), [I, O], "h1");
				return { v1, v2: step(v1.row, [I, later, O], "h2") };
			};
			it(`${id}.1`, () => {
				check(chain().v1, null);
			});
			it(`${id}.2`, () => {
				check(chain().v2, null);
			});
		}
	});

	describe("R8 against both exact and basisQuote: chains of single-word edits", () => {
		for (const [id, quote, versions, wants] of [
			[
				"CH1",
				"slender steel bridge",
				[
					"The slender steel bridge crossed the river.",
					"The slim steel bridge crossed the river.",
					"The slim iron bridge crossed the river.",
					"The slim iron span crossed the river.",
					"The slender steel bridge crossed the river.",
				],
				[
					"slim steel bridge",
					"slim iron bridge",
					"slim iron span",
					"slender steel bridge",
				],
			],
			[
				"CH2",
				"old wooden ferry carried twelve passengers",
				[
					"The old wooden ferry carried twelve passengers across.",
					"The old wooden boat carried twelve passengers across.",
					"The old wooden boat carried ten passengers across.",
					"The old painted boat carried ten passengers across.",
				],
				[
					"old wooden boat carried twelve passengers",
					"old wooden boat carried ten passengers",
					"old painted boat carried ten passengers",
				],
			],
		] as const) {
			for (let n = 1; n < versions.length; n++) {
				it(`${id}.${n}`, () => {
					let row = mk([I, versions[0], O], quote);
					let x: Step | undefined;
					for (let v = 1; v <= n; v++) {
						x = step(row, [I, versions[v], O], `h${v}`);
						row = x.row;
					}
					assert.ok(x);
					check(x, wants[n - 1]);
				});
			}
		}
	});

	describe("R3, a sentence moved and edited", () => {
		const KF = "The key finding was surprising.";
		const KQ = "key finding was surprising";
		const ME = "Methods were standard.";
		const DT = "Data came from three sites.";
		const O1 = "Other para one is here.";
		const O2 = "Other para two is here.";
		for (const [id, before, after, quote] of [
			[
				"MV1",
				[I, KF, ME, DT, O],
				[
					I,
					ME,
					DT,
					"Overall, the key finding was surprising to many readers.",
					O,
				],
				KQ,
			],
			[
				"MV2",
				[
					"Step one: heat the pan.",
					"Step two: add eggs.",
					"Step three: stir well.",
				],
				[
					"Step one: heat the pan.",
					"Step three: stir well.",
					"Step two: add eggs and milk.",
				],
				"add eggs",
			],
			[
				"MV3",
				[KF, O1, O2],
				[O1, "The key finding was surprising, said the authors.", O2],
				KQ,
			],
			[
				"MV4",
				[`Intro sentence here. ${KF}`, "Next para text is here."],
				[
					"Intro sentence here.",
					"Next para text is here. The key finding was surprising!",
				],
				KQ,
			],
			["MV5", [KF, O1, O2], [O1, KF, O2], KQ],
		] as const) {
			it(id, () => {
				check(step(mk(before, quote), after, "h1"), quote);
			});
		}
	});

	describe("H4, deleted sentences whose words return", () => {
		const SF = "Sales fell sharply in Europe last year.";
		const CV = "The company makes cars and vans.";
		const SR = "Its shares rose on Monday.";
		const FQ = "fell sharply in Europe";
		const RP =
			"In a report that surprised analysts and investors on Tuesday, the firm said its sales fell sharply in Europe last year amid weak demand for its cars.";
		for (const [id, after] of [
			["NA1", [I, CV, SR, RP, O]],
			["NA2", [I, CV, RP, SR, O]],
		] as const) {
			it(id, () => {
				check(step(mk([I, SF, CV, SR, O], FQ), after, "h1"), FQ);
			});
		}
		it("PQ1", () => {
			check(step(mk([I, SF, CV, SF, O], FQ), [I, CV, SF, O], "h1"), FQ);
		});
		it("TWIN.PQ1 differs from its twin: the deleted sentence moves to its kept copy, and without the copy it is gone", () => {
			const x = check(step(mk([I, SF, CV, O], FQ), [I, CV, O], "h1"), null);
			assert.equal(x.counts.gone, 1);
		});
	});

	describe("R11 never draws a refused row", () => {
		const EL =
			"Elsewhere, the old bridge was shut for repairs too, said the council.";
		for (const [id, versions, quote] of [
			[
				"PWA",
				[
					[
						"Intro.",
						"The mayor said the city council will vote next week on the budget.",
						"Other text here.",
						"In another story, the city council will vote on parking.",
					],
					[
						"Intro.",
						"Other text here.",
						"In another story, the city council will vote on parking.",
					],
				],
				"the city council will vote",
			],
			[
				"PWB",
				[
					[I, "Last week the old bridge was closed for repairs.", EL, O],
					[I, "Last week the old bridge was shut for repairs.", EL, O],
					[I, EL, O],
				],
				"old bridge was closed for repairs",
			],
			[
				"PWC",
				[
					[
						I,
						"Our results show the method works well on small samples.",
						"Critics say the method works well only in theory.",
						O,
					],
					[
						I,
						"Our results were inconclusive.",
						"Critics say the method works well only in theory.",
						O,
					],
				],
				"the method works well",
			],
		] as const) {
			for (const kind of ["served", "window"] as const) {
				it(`${id}.${kind}`, () => {
					let prev = mk(versions[0], quote);
					let x: Step | undefined;
					for (let v = 1; v < versions.length; v++) {
						if (x !== undefined) prev = x.row;
						x = step(prev, versions[v], `h${v}`);
					}
					assert.ok(x);
					const h = `h${versions.length - 1}`;
					const t = textOf(versions[versions.length - 1] ?? []);
					assert.equal(x.row.anchorState, "orphaned");
					assert.equal(onPage(t, kind === "served" ? x.row : prev, h), null);
				});
			}
		}
	});

	describe("R11 in the window, before the handler has run", () => {
		const NP = "A new first paragraph.";
		it("WN1", () => {
			const r0 = mk([I, S0, O], Q0);
			const t1 = textOf([NP, I, S0, O]);
			const p = onPage(t1, r0, "h1");
			assert.ok(p !== null);
			assert.equal(p.start, t1.indexOf(Q0));
			assert.equal(slice(t1, p), Q0);
		});
		it("WN2", () => {
			const v1 = step(mk([I, S0, O], Q0), [I, S2, O], "h1");
			const t2 = textOf([NP, I, S2, O]);
			assert.equal(
				slice(t2, onPage(t2, v1.row, "h2")),
				"most admired structure in the whole city",
			);
		});
	});

	describe("R10, a place the diff chose takes its own context", () => {
		const SB1 =
			"Built in 1900, it is the most admired structure in the whole city. It draws crowds.";
		const G =
			"Built in 1900, it is the most admired structure in the whole city. Tourists come from far away to see it.";
		const RQ = "most admired structure in the whole city";
		const v1p = [I, SB1, O, G];
		const rc1 = () =>
			step(
				mk(
					[
						I,
						"Built in 1900, it is the most admired structure in the city. Tourists come from far away to see it.",
						O,
					],
					"most admired structure in the city",
				),
				v1p,
				"h1",
			);
		const at = (t: string) => t.indexOf(SB1) + SB1.indexOf(RQ);
		it("RC1.1", () => {
			const v1 = rc1();
			assert.notEqual(v1.anchor.anchorState, "orphaned");
			assert.equal(v1.anchor.start, at(textOf(v1p)));
			assert.equal(v1.served, RQ);
		});
		it("RC1.2", () => {
			assert.equal(onPage(textOf([I, CAP, SB1, O, G]), rc1().row, "h1"), null);
		});
		it("RC1.3", () => {
			const v1 = rc1();
			const v3 = step(
				rerender(v1.row, [I, CAP, SB1, O, G]),
				[I, CAP, SB1, O, G, END],
				"h2",
			);
			assert.equal(v3.served, null);
			assert.notEqual(v3.row.basisCandidateId, undefined);
			assert.equal(v3.row.basisQuote, v1.row.basisQuote);
		});
	});

	it("RV1s", () => {
		const OLD =
			"Yesterday the quick brown fox jumps over the lazy dog near the old river bank.";
		const RQ = "quick brown fox jumps over the lazy dog";
		const v1 = step(
			mk([OLD], RQ),
			[
				"Yesterday the quick brown big red wolf jumps over the lazy dog near the old river bank.",
			],
			"h1",
		);
		const rv = todayStep(v1.row, [OLD], "h2");
		const t2 = textOf([OLD]);
		const st = storedState(rv, "h2");
		const main =
			(st.state === "anchored" || st.state === "moved") &&
			rv.basisQuote !== undefined
				? rv.basisQuote
				: rv.exact;
		assert.notEqual(v1.row.basisQuote, undefined);
		assert.equal(st.state, "anchored");
		assert.equal(st.edited, false);
		assert.equal(main, RQ);
		assert.equal(slice(t2, onPage(t2, rv, "h2")), RQ);
	});

	describe("short highlights that follow their words into another sentence", () => {
		for (const [id, before, after, quote] of [
			[
				"A5",
				[I, "Three people were arrested by police after a fight broke out.", O],
				[I, "Traffic police will close several streets near the river.", O],
				"police",
			],
			[
				"A2",
				[I, "Crime fell sharply in the city during the summer months.", O],
				[I, "Rents are rising in the city as students return.", O],
				"in the city",
			],
			[
				"RM2",
				[
					I,
					"The minister resigned on Monday after the vote.",
					"Second para text.",
					"Third para text.",
					O,
				],
				[
					I,
					"Second para text.",
					"Third para text.",
					"The minister resigned from the board in 2019 after a vote.",
					O,
				],
				"The minister resigned",
			],
		] as const) {
			it(id, () => {
				check(step(mk(before, quote), after, "h1"), quote);
			});
		}
	});

	describe("the page draws step 1's place of a row with no basis", () => {
		const V0 = "Critics said the slender steel bridge was a marvel of design.";
		const V1 =
			"Many critics said the slender steel bridges were a marvel of design.";
		const EP = "Elsewhere, the slender steel bridge appeared in photos.";
		const V3 =
			"Many critics said the old bridges were a marvel of modern design.";
		const q = "the slender steel bridge";
		it("OH1p", () => {
			const s1 = todayStep(mk([I, V0, O], q), [I, V1, O], "h1");
			const t1 = textOf([I, V1, O]);
			assert.equal(slice(t1, onPage(t1, s1, "h1")), "the slender steel bridge");
			assert.equal(storedState(s1, "h1").edited, false);
		});
		const chain: readonly (readonly [readonly string[], string])[] = [
			[[I, V1, O], "the slender steel bridges"],
			[[I, V1, EP, O], "the slender steel bridges"],
			[[I, V3, EP, O], "the old bridges"],
		];
		for (let n = 1; n <= chain.length; n++) {
			it(`OH1d.${n}`, () => {
				let row = mk([I, V0, O], q);
				let x: Step | undefined;
				for (let v = 1; v <= n; v++) {
					const link = chain[v - 1];
					assert.ok(link);
					x = step(row, link[0], `h${v}`);
					row = x.row;
				}
				const last = chain[n - 1];
				assert.ok(x && last);
				check(x, last[1]);
			});
		}
	});

	it("SS1", () => {
		const v1 = step(mk([I, S0, O], Q0), [I, S2, O], "h1");
		const v2 = step(v1.row, [I, O], "h2");
		const st = (row: Row, h: string | undefined) => {
			const x = storedState(row, h);
			return x.state + (x.edited ? ", edited" : "");
		};
		assert.equal(
			[
				st(v1.row, "h1"),
				st(v1.row, "h2"),
				st(v1.row, undefined),
				st(v2.row, "h2"),
			].join(" | "),
			"moved, edited | pending | moved, edited | orphaned",
		);
	});

	it("LS1", () => {
		let seed = 5;
		const rnd = () => {
			seed = (seed * 48271) % 2147483647;
			return seed / 2147483647;
		};
		const ws = Array.from(
			{ length: 20000 },
			() => `w${Math.floor(rnd() * 5000).toString(36)}`,
		);
		const at = [5000, 10000, 15000];
		const before = ws.join(" ");
		const after = ws
			.map((w, i) => (at.includes(i - 2) ? "edited" : w))
			.join(" ");
		const basis = candidateFor(before);
		const rows: Row[] = at.map((i) => {
			const q = ws.slice(i, i + 6).join(" ");
			const s = ` ${before}`.indexOf(` ${q} `);
			return {
				...describeRange({ text: before, start: s, end: s + q.length }),
				basisCandidateId: basis,
				anchoredContentHash: "h0",
				anchorState: "anchored",
				orderKey: s,
				anchorRevision: 1,
			};
		});
		const index = createWordIndex();
		const tokens = index.tokenize(before);
		const words = index
			.sentences(tokens)
			.map(
				([low, high]) =>
					tokens.keys.slice(low, high).filter(index.isWord).length,
			);
		assert.deepEqual([words.length, Math.max(...words)], [200, 100]);
		const { writes, counts } = reanchorArticleHighlights({
			text: after,
			contentHash: "h1",
			candidateId: candidateFor(after),
			highlights: rows,
			anchorTexts: new Map([[basis, before]]),
		});
		assert.deepEqual(
			writes.map((w) => w.anchor.anchorState),
			["moved", "moved", "moved"],
		);
		assert.equal(counts.edited, 3);
	});

	describe("R3's fallback ranks without containment", () => {
		const P3 = [
			"We tested the new release on a dozen handsets last week.",
			"It works.",
			"Several readers asked about battery life and the camera.",
			"It works on every phone we tried.",
			"More notes will follow soon.",
		];
		const P4 = [
			"The quarterly report arrived on Monday morning.",
			"Results were good. Prices fell.",
			"Analysts had expected a weaker showing after the summer.",
			"Prices fell sharply in the north. Results were good overall this year.",
			"The board meets again in March.",
		];
		for (const [id, P, quote, at] of [
			["CT5", P3, "It works", 148],
			["CT3", P4, "Results were good. Prices fell", 176],
			["CT4", P4, "Prices fell", 195],
		] as const) {
			it(id, () => {
				const after = [P[0], P[3], P[2], P[1], P[4]].map((p) => p ?? "");
				checkAt(step(mk(P, quote), after, "h1"), quote, at);
			});
		}
	});

	it("DIR1", () => {
		const r0 = mk(
			["The old bridge was closed in May. The council met on Monday."],
			"old bridge",
		);
		checkAt(
			step(
				r0,
				[
					"The old bridge was sold. The old bridge was closed in June. The council met on Monday.",
				],
				"h1",
			),
			"old bridge",
			29,
		);
	});

	it("FBA1", () => {
		const A1 = "The council met on Monday to review the budget.";
		const E1 = "Engineers closed the old bridge for repairs.";
		const B1 = "Residents asked about the school timetable.";
		const W1 = "A new bridge will open next year.";
		checkAt(
			step(mk([A1, E1, B1], "closed the old bridge"), [A1, W1, B1, E1], "h1"),
			"closed the old bridge",
			136,
		);
	});

	it("EG2s", () => {
		const LQ =
			"Instead of commissioning a single grand plan and defending it against every objection, the transport office began publishing small drafts, inviting criticism early";
		const BASE = [
			"The city council met on Monday to approve the annual budget for road repairs.",
			"Engineers praised the slender steel span that crosses the river near the old mill, calling it a triumph of design.",
			"Weekday ridership has passed the forecasts made five years ago, and traffic on the avenue has fallen by a fifth.",
			"On Monday the committee passed the budget for road repairs after a long debate. On Tuesday the committee passed the budget for the new schools without objection. On Tuesday the committee passed the budget despite loud protests from residents.",
			"Later that week residents asked the city council to reconsider the decision on parking fees downtown.",
			"The bridge is now the most photographed structure in the region, and visitors arrive every weekend to see it.",
			"What other towns can learn is patience, and the most photographed structure is only a small part of that lesson.",
			`Nobody expected much to change in how the city made decisions. ${LQ} and revising them in public.`,
			"The session closed at noon.",
		];
		const NOTE = "Editor's note: this article was updated in November.";
		const r0 = mk([...BASE, ...BASE], "The city council");
		checkAt(
			step(r0, [NOTE, ...BASE, ...BASE], "h1"),
			"The city council",
			NOTE.length + 1,
		);
	});

	describe("R4's runs of two and R3's enders", () => {
		for (const [id, before, after, quote, want, at] of [
			[
				"TH1",
				"ประชาชนสินค้ารัฐบาล รัฐบาลสินค้าสินค้า ประชุมรัฐบาลตลาด",
				"ประชาชนสินค้าประชาชนรัฐบาล รัฐบาลสินค้าสินค้า ประชุมรัฐบาลตลาด",
				"รัฐบาลสินค้า",
				"รัฐบาลสินค้า",
				27,
			],
			[
				"ZH1",
				"学生会议政府，政治经济市场，政治会议市场经济",
				"学生政府会议政府，政治经济市场，政治会议市场经济",
				"政治经济",
				"政治经济",
				9,
			],
			[
				"HI1",
				"कल शहर में भारी बारिश हुई। लोग अपने घरों में ही रहे और बाहर नहीं निकले।",
				"आज बाजार में सोना सस्ता हुआ। लोग अपने घरों में ही रहे और बाहर नहीं निकले।",
				"शहर में",
				null,
				null,
			],
		] as const) {
			it(id, () => {
				checkAt(step(mk([before], quote), [after], "h1"), want, at);
			});
		}
	});

	describe("D1, a found row with no stored basis starts from its anchor's body", () => {
		const M = "Weather was mild all week.";
		const N = "Up north the old bridge was closed for repairs in autumn.";
		const S = "Down south the old bridge carried trains until the flood came.";
		const da1 = () =>
			step(bare(mk([I, N, M, S, O], "the old bridge")), [I, M, S, O], "h1", [
				I,
				N,
				M,
				S,
				O,
			]);
		it("DA1", () => {
			assert.equal(da1().anchor.anchorState, "orphaned");
		});
		it("DA1.2", () => {
			assert.equal(
				step(
					da1().row,
					[I, M, S.replace("old bridge", "old iron bridge"), O],
					"h2",
				).anchor.anchorState,
				"orphaned",
			);
		});
		const F0 =
			"Yesterday the quick brown fox jumps over the lazy dog near the old river bank.";
		const F1 = F0.replace("jumps", "leaps");
		const FQ = "quick brown fox jumps over the lazy dog";
		const FQ1 = "quick brown fox leaps over the lazy dog";
		it("DA2", () => {
			const x = check(
				step(bare(mk([I, F0, O], FQ)), [I, F1, O], "h1", [I, F0, O]),
				FQ1,
			);
			assert.equal(levelOf(x), "diff");
			assert.notEqual(x.row.basisCandidateId, undefined);
			assert.equal(x.row.basisQuote, FQ1);
		});
		const da3 = () => {
			const l1 = todayStep(bare(mk([I, F0, O], FQ)), [I, F1, O], "h1");
			const c = step(l1, [I, F1, O, END], "h2", [I, F1, O]);
			return {
				c,
				d: step(c.row, ["New lead.", I, F1, O, END], "h3", [I, F1, O, END]),
			};
		};
		it("DA3", () => {
			const { c } = da3();
			check(c, FQ1);
			assert.equal(levelOf(c), "today");
			assert.equal(c.row.basisCandidateId, undefined);
			assert.equal(c.row.basisQuote, FQ1);
		});
		it("DA3.2", () => {
			const { d } = da3();
			check(d, FQ1);
			assert.equal(levelOf(d), "diff");
			assert.notEqual(d.row.basisCandidateId, undefined);
		});
		const wr1 = () => step(mk([I, F0, O], FQ), [I, F1, O], "h1");
		it("WR1.1", () => {
			const t2 = textOf([I, F0, O, END]);
			assert.equal(onPage(t2, wr1().row, "h2"), null);
		});
		it("WR1.2", () => {
			check(step(wr1().row, [I, F0, O, END], "h2"), FQ);
		});
	});

	describe("DA1 in Thai and Chinese, where the stored context is empty", () => {
		const T1 =
			"เมื่อฤดูหนาวปีที่แล้วรัฐบาลประกาศว่าจะสร้างสะพานใหม่ข้ามแม่น้ำในภาคเหนือเพื่อบรรเทาปัญหาการจราจรและส่งเสริมเศรษฐกิจท้องถิ่น";
		const T2 =
			"กรมอุตุนิยมวิทยาพยากรณ์ว่าสัปดาห์นี้อุณหภูมิจะลดลงอย่างต่อเนื่องจึงขอให้ประชาชนดูแลสุขภาพ";
		const T3 =
			"ชาวบ้านในภาคใต้ก็หวังว่าจะสร้างสะพานใหม่ข้ามแม่น้ำในพื้นที่ของตนแต่ยังไม่มีงบประมาณจึงต้องเลื่อนโครงการออกไป";
		const Z0 = "本报记者昨日从市政府新闻办公室获悉以下消息。";
		const C1 =
			"去年冬天市政府在新闻发布会上正式宣布将投入大量资金在北部地区的河流上修建一座新的大桥以缓解长期存在的交通压力并且进一步促进当地经济发展和居民就业同时改善周边环境。";
		const C2 =
			"气象部门预报说本周气温将持续偏低请广大市民注意保暖并尽量减少不必要的外出活动。";
		const C3 =
			"住在南部地区的许多居民多年来也一直希望有关部门能够尽快在他们附近的河流上修建一座新的大桥但是由于资金始终没有着落所以这项计划已经被搁置了很长时间。";
		for (const [id, old, now, later, q] of [
			[
				"TH",
				[T1, T2, T3],
				[T2, T3],
				[T2, T3.replace("สะพานใหม่", "สะพานเหล็ก")],
				"สร้างสะพานใหม่ข้ามแม่น้ำ",
			],
			[
				"ZH",
				[Z0, C1, C2, C3],
				[Z0, C2, C3],
				[Z0, C2, C3.replace("新的大桥", "更宽的大桥")],
				"修建一座新的大桥",
			],
		] as const) {
			const v1 = () => step(bare(mk(old, q)), now, "h1", old);
			it(`${id}2`, () => {
				assert.equal(v1().anchor.anchorState, "orphaned");
			});
			it(`${id}2.2`, () => {
				assert.equal(
					step(v1().row, later, "h2").anchor.anchorState,
					"orphaned",
				);
			});
			it(`${id}3`, () => {
				const t = textOf(now);
				assert.equal(onPage(t, step(mk(old, q), old, "h0").row, "h1"), null);
			});
		}
	});

	describe("the reader's words stand verbatim and only a character beside them changed", () => {
		for (const [id, before, after, quote] of [
			[
				"SN1",
				"We walked through the old part of the city, another thing we had planned.",
				"We walked through the old part of the city—another thing we had planned.",
				"another thing",
			],
			[
				"SN2",
				"The years 2019 and 2020 saw a fall in sales.",
				"The years 2019–2020 saw a fall in sales.",
				"2020 saw a fall",
			],
			[
				"SN3",
				"The build was finally ready. Critics disagreed with it.",
				"The build was finally ready.Critics disagreed with it.",
				"Critics disagreed",
			],
		] as const) {
			it(`${id}.page`, () => {
				const t = textOf([I, after, O]);
				assert.equal(
					slice(t, onPage(t, bare(mk([I, before, O], quote)), "h1")),
					quote,
				);
			});
			it(`${id}d`, () => {
				const x = check(
					step(mk([I, before, O], quote), [I, after, O], "h1"),
					quote,
				);
				assert.equal(x.row.basisQuote, undefined);
			});
		}
	});

	it("EE1", () => {
		check(
			step(
				mk([I, "Prices rose to five in March.", O], "rose to five"),
				[I, "Prices rose to $5 in March.", O],
				"h1",
			),
			"rose to $5",
		);
	});

	it("AN1", () => {
		assert.equal(
			step(
				mk([I, "The tower is tall.", O], "tower is tall"),
				[I, "The tower is tall.", O, END],
				"h1",
			).anchor.anchorState,
			"anchored",
		);
	});

	it("AN2", () => {
		assert.equal(
			step(
				mk([I, "The tower is tall.", O], "tower is tall"),
				["New lead.", I, "The tower is tall.", O],
				"h1",
			).anchor.anchorState,
			"moved",
		);
	});

	it("SP1", () => {
		check(
			step(
				mk([A, Bp, C, Dp, E], "approve the new harbour plan. Work on the pier"),
				[
					A,
					C,
					"The council voted to approve the new harbour plan. Shop talk filled the gap entirely.",
					Dp,
					"Work on the pier starts in spring. Extra words follow here.",
					E,
				],
				"h1",
			),
			null,
		);
	});

	describe("HD2, R1's first try holds the row's words", () => {
		const Z0 = "本报记者昨日从市政府新闻办公室获悉以下消息。";
		const C1 =
			"去年冬天市政府在新闻发布会上正式宣布将投入大量资金在北部地区的河流上修建一座新的大桥以缓解长期存在的交通压力并且进一步促进当地经济发展和居民就业同时改善周边环境。";
		const C3L =
			"住在南部地区的许多居民多年来也一直希望有关部门能够尽快在他们附近的河流上修建一座新的大桥但是由于资金始终没有着落所以这项计划已经被搁置了很长时间而且至今仍然没有任何新的进展和消息。";
		const ed = (x: string) => x.replace("新的大桥", "更宽的大桥");
		const w = "修建一座更宽的大桥";
		const h1 = () =>
			step(
				mkLast([Z0, C1, C3L], "修建一座新的大桥"),
				[Z0, ed(C1), ed(C3L)],
				"h1",
			);
		it("HD2.1", () => {
			checkAt(h1(), w, 142);
		});
		it("HD2.2", () => {
			checkAt(
				step(h1().row, [Z0, ed(C1), ed(C3L), "新增的结尾段落。"], "h2"),
				w,
				142,
			);
		});
	});

	it("CORR", () => {
		const index = createWordIndex();
		const v = index.corr({
			a: index.words("committee"),
			b: index.words("commitee"),
			plain: false,
		});
		assert.ok(v <= 1, `corr ${v}`);
	});
});
