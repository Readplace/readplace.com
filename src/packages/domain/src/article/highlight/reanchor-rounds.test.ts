import assert from "node:assert/strict";
import {
	type CandidateId,
	CandidateIdSchema,
} from "@packages/article-state-types";
import { anchorHighlightFuzzy } from "./anchor-highlight-fuzzy";
import type { AnchorState } from "./highlight";
import { highlightOnPage } from "./highlight-on-page";
import {
	type HighlightAnchorUpdate,
	type ReanchorableHighlight,
	type ReanchorCounts,
	reanchorArticleHighlights,
} from "./reanchor-article-highlights";
import { storedHighlightState } from "./stored-highlight-state";
import { describeRange, normaliseText } from "./text-anchoring";
import { createWordIndex } from "./word-index";

type Row = ReanchorableHighlight;

interface Versions {
	texts: Map<CandidateId, string>;
}

interface Step {
	text: string;
	row: Row;
	start: number;
	state: AnchorState;
	served: string | null;
	reason: "gone" | "notPlaced" | undefined;
	counts: ReanchorCounts;
}

function textOf(paras: readonly string[]): string {
	return normaliseText(
		paras.map((text) => ({ text, blockBoundaryBefore: true })),
	).text;
}

function versions(): Versions {
	return { texts: new Map() };
}

function addVersion(v: Versions, text: string): CandidateId {
	const id = CandidateIdSchema.parse(`c${v.texts.size}`);
	v.texts.set(id, text);
	return id;
}

function mkT(params: {
	v: Versions;
	text: string;
	start: number;
	end: number;
	basis?: boolean;
}): Row {
	const { v, text, start, end } = params;
	const id = addVersion(v, text);
	return {
		...describeRange({ text, start, end }),
		anchoredContentHash: "h0",
		anchorState: "anchored",
		orderKey: start,
		anchorRevision: 1,
		...(params.basis === false ? {} : { basisCandidateId: id }),
	};
}

function mk(
	v: Versions,
	paras: readonly string[],
	quote: string,
	options: { nth?: number; basis?: boolean } = {},
): Row {
	const text = textOf(paras);
	let start = text.indexOf(quote);
	assert.ok(start >= 0, `"${quote}" must be in the text`);
	for (let k = 0; k < (options.nth ?? 0); k++)
		start = text.indexOf(quote, start + 1);
	return mkT({
		v,
		text,
		start,
		end: start + quote.length,
		basis: options.basis,
	});
}

function applyWrite(row: Row, anchor: HighlightAnchorUpdate): Row {
	const {
		anchoredCandidateId: _a,
		basisCandidateId: _b,
		basisQuote: _q,
		...kept
	} = row;
	return { ...kept, ...anchor, anchorRevision: row.anchorRevision + 1 };
}

function stepText(params: {
	v: Versions;
	row: Row;
	text: string;
	hash: string;
	body?: readonly string[];
}): Step {
	const { v, text, hash, body } = params;
	const candidateId = addVersion(v, text);
	const row =
		body === undefined
			? params.row
			: { ...params.row, anchoredCandidateId: addVersion(v, textOf(body)) };
	const { writes, counts } = reanchorArticleHighlights({
		text,
		contentHash: hash,
		candidateId,
		highlights: [row],
		anchorTexts: v.texts,
	});
	const [write] = writes;
	assert.ok(write, "the row is written");
	const { anchor } = write;
	const reason =
		counts.gone === 1 ? "gone" : counts.notPlaced === 1 ? "notPlaced" : undefined;
	return {
		text,
		row: applyWrite(row, anchor),
		start: anchor.start,
		state: anchor.anchorState,
		served:
			anchor.anchorState === "orphaned"
				? null
				: text.slice(anchor.start, anchor.end),
		reason,
		counts,
	};
}

function step(
	v: Versions,
	row: Row,
	paras: readonly string[],
	hash: string,
	body?: readonly string[],
): Step {
	return stepText({ v, row, text: textOf(paras), hash, body });
}

function edited(row: Row): boolean {
	return storedHighlightState({ highlight: row, contentHash: undefined })
		.edited;
}

function outcome(x: Step, withReason = true): string {
	if (x.state === "orphaned")
		return withReason ? `orphaned (${x.reason})` : "orphaned";
	return `${x.state}@${x.start}${edited(x.row) ? "e" : ""}`;
}

function chain(params: {
	v: Versions;
	row: Row;
	versions: readonly (readonly string[])[];
	withReason?: boolean;
}): string[] {
	let row = params.row;
	return params.versions.map((paras, i) => {
		const x = step(params.v, row, paras, `h${i + 1}`);
		row = x.row;
		return outcome(x, params.withReason ?? true);
	});
}

function todayIs(row: Row, paras: readonly string[]): string {
	const a = anchorHighlightFuzzy({
		text: textOf(paras),
		contentHash: "h1",
		highlight: row,
	});
	return a.anchorState === "orphaned" ? "orphaned" : `${a.anchorState} @${a.start}`;
}

function paragraphAt(text: string, at: number): string {
	const a = text.lastIndexOf("\n", at - 1) + 1;
	const b = text.indexOf("\n", at);
	return text.slice(a, b < 0 ? text.length : b);
}

function view(x: Step): string {
	if (x.state === "orphaned") return `orphaned (${x.reason})`;
	return JSON.stringify([
		x.served,
		paragraphAt(x.text, x.start),
		edited(x.row),
	]);
}

const I = "Intro here.";
const O = "Outro here.";
const M = "Weather was mild all week.";
const END = "A closing line.";
const ME = "Methods were standard.";
const DT = "Data came from three sites.";
const N = "Up north the old bridge was closed for repairs in autumn.";
const S = "Down south the old bridge carried trains until the flood came.";
const N1 = N.replace("old bridge", "old iron bridge");
const BQ = "the old bridge was closed for repairs";
const VOTE = "The vote was close.";
const CRITICS =
	"Critics said the old bridge plan ignored cyclists and pedestrians entirely.";
const VOTE_CRITICS =
	"The vote was close, and critics said the old bridge plan ignored cyclists and pedestrians entirely.";
const CRITICS_VOTE =
	"Critics said the old bridge plan ignored cyclists and pedestrians entirely, and the vote was close.";
const VQ = "vote was close";
const ALICE = "Alice Smith was elected to the council in 2019.";
const BOB = "Bob Jones was elected to the council in 2021.";
const ELECTED = "elected to the council";
const GATE = "Engineers inspected the Golden Gate Bridge after the quake.";
const TOURISTS = "Tourists crowded the Golden Gate Bridge on Sunday.";
const GQ = "Golden Gate Bridge";
const W = "We never expected the river to rise that fast.";
const MF = "Many families left the valley.";
const BW = `${W} ${MF}`;
const BW2 = `${MF} ${W}`;
const Q = "the river to rise";
const A = "Officials met on Tuesday to review the plan.";
const B0 = `${A} ${W} ${MF}`;
const AM = `${A} ${MF}`;
const U = "Engineers say the river to rise again is unlikely this year.";
const E1 = "We never expected the creek to rise that fast.";
const BN1 = `${A} ${E1} ${MF}`;
const BN2 = `${A} Nobody expected the water to climb so fast. ${MF}`;
const Z = "Ferries now leave the harbour every half hour.";

function go(
	basis: readonly string[],
	nth: number,
	paras: readonly string[],
): Step {
	const v = versions();
	return step(v, mk(v, basis, Q, { nth }), paras, "h1");
}

describe("re-anchoring, the decided fixtures", () => {
	const P2 =
		"Two years on, ridership has passed the forecasts and traffic on the avenue has fallen by a fifth.";
	const MQ = "ridership has passed the forecasts and traffic on the avenue";
	const WANT =
		"ridership has passed the projections and traffic on the boulevard";
	const J3B_NOW = [
		I,
		P2.replace("forecasts", "projections").replace("avenue", "boulevard"),
		O,
	];

	it("J3b.page", () => {
		const v = versions();
		const t1 = textOf(J3B_NOW);
		const pg = highlightOnPage({
			text: t1,
			contentHash: "h1",
			highlight: mk(v, [I, P2, O], MQ, { basis: false }),
		});
		assert.ok(pg);
		assert.equal(t1.slice(pg.start, pg.end), WANT);
	});

	it("J3b.handler", () => {
		const v = versions();
		const x = step(v, mk(v, [I, P2, O], MQ, { basis: false }), J3B_NOW, "h1");
		assert.equal(x.counts.diffed, 0);
		assert.equal(x.served, WANT);
		assert.equal(x.row.basisQuote, WANT);
	});

	for (const [id, was, now, q, want] of [
		[
			"FS2",
			"Send an email to the office today.",
			"Send an e-mail to the office today.",
			"email to the office",
			"e-mail to the office",
		],
		[
			"FS3",
			"They do not agree on the matter at all.",
			"They don't agree on the matter at all.",
			"do not agree",
			"don't agree",
		],
	] as const) {
		it(id, () => {
			const v = versions();
			const x = step(v, mk(v, [I, was, ME, DT, O], q), [I, ME, DT, now, O], "h1");
			assert.equal(x.served, want);
		});
	}

	it("BG2", () => {
		const v = versions();
		const row = {
			...mk(v, [I, N, O], "the old bridge"),
			basisCandidateId: CandidateIdSchema.parse("c-gone"),
		};
		const x = step(v, row, [I, N, O, END], "h1");
		assert.equal(x.counts.basisMissing, 1);
		assert.equal(x.served, "the old bridge");
		assert.equal(x.row.basisCandidateId, undefined);
	});

	function orphanOn(v: Versions): Row {
		return {
			...mk(v, [I, N, O], "the old bridge", { basis: false }),
			anchorState: "orphaned",
			anchoredContentHash: "h1",
		};
	}

	it("OR1", () => {
		const v = versions();
		const x = step(v, orphanOn(v), [I, N, O, END], "h2", [
			I,
			"Something else entirely stood here.",
			O,
		]);
		assert.equal(x.counts.diffed, 0);
		assert.equal(x.served, "the old bridge");
	});

	it("OR2", () => {
		const v = versions();
		const x = step(v, orphanOn(v), [I, N1, O], "h2", [I, N, O]);
		assert.equal(x.counts.diffed, 1);
		assert.equal(x.served, "the old iron bridge");
		assert.notEqual(x.row.basisCandidateId, undefined);
	});

	const A2 = "The final vote in the council chamber was close.";
	const AB2 = VOTE_CRITICS.replace(
		"The vote was close",
		"The final vote in the council chamber was tight",
	);
	const W9 = "Weekday ridership has passed the forecasts made five years ago.";
	const FQ2 = "final vote in the council chamber was close";
	const P1O = [I, `${VOTE} ${CRITICS}`, M, ME, DT, O];
	const P1N = [I, M, ME, DT, VOTE_CRITICS, O];

	function placedAt(x: Step, want: string, pos: number, isEdited = false) {
		assert.notEqual(x.state, "orphaned");
		assert.equal(x.served, want);
		assert.equal(x.start, pos);
		assert.equal(edited(x.row), isEdited);
	}

	it("P1", () => {
		const v = versions();
		placedAt(step(v, mk(v, P1O, VQ), P1N, "h1"), VQ, 94);
	});

	it("P2", () => {
		const v = versions();
		placedAt(
			step(
				v,
				mk(v, [I, VOTE_CRITICS, M, ME, DT, O], VQ),
				[I, M, ME, DT, `${VOTE} ${CRITICS}`, O],
				"h1",
			),
			VQ,
			94,
		);
	});

	it("P3", () => {
		const v = versions();
		placedAt(
			step(v, mk(v, [I, N, M, ME, DT, O], BQ), [I, M, ME, N, DT, N, O], "h1"),
			BQ,
			71,
		);
	});

	it("P1s", () => {
		const v = versions();
		placedAt(
			step(
				v,
				mk(v, [I, `${VOTE} ${CRITICS}`, M, ME, DT, "A close call for everyone.", O], VQ),
				P1N,
				"h1",
			),
			VQ,
			94,
		);
	});

	it("P1.k", () => {
		const v = versions();
		const x1 = step(v, mk(v, P1O, VQ, { basis: false }), P1N, "h1", P1O);
		placedAt(x1, VQ, 94);
		const x2 = step(v, x1.row, [...P1N, "One more line."], "h2");
		placedAt(x2, VQ, 94);
		assert.notEqual(x2.row.basisCandidateId, undefined);
	});

	it("P1q", () => {
		const v = versions();
		const q0 = [I, `${A2} ${CRITICS}`, M, ME, DT, O];
		const x1 = step(
			v,
			mk(v, q0, FQ2),
			[I, `${A2.replace("close", "tight")} ${CRITICS}`, M, ME, DT, O],
			"h1",
		);
		placedAt(x1, "final vote in the council chamber was tight", 16, true);
		placedAt(
			step(v, x1.row, [I, M, ME, DT, AB2, O], "h2"),
			"final vote in the council chamber was tight",
			94,
			true,
		);
	});

	it("P1e", () => {
		const v = versions();
		const q0 = [I, `${A2} ${CRITICS}`, M, ME, DT, O];
		const now = [I, M, ME, DT, AB2, O];
		assert.equal(step(v, mk(v, q0, FQ2), now, "h1").state, "orphaned");
		assert.equal(todayIs(mk(versions(), q0, FQ2), now), "orphaned");
	});

	it("P3b", () => {
		const v = versions();
		const N2 = N.replace("old bridge", "old iron bridge");
		const now = [I, M, ME, N2, DT, N2, O];
		const was = [I, N, M, ME, DT, O];
		assert.equal(step(v, mk(v, was, BQ), now, "h1").state, "orphaned");
		assert.equal(todayIs(mk(versions(), was, BQ), now), "orphaned");
	});

	it("XN", () => {
		const v = versions();
		const x = step(
			v,
			mk(v, [I, N, M, S, O], "the old bridge"),
			[I, M, S, O, "Readers asked about the old bridge."],
			"h1",
		);
		assert.equal(x.state, "orphaned");
	});

	it("G1", () => {
		const v = versions();
		const x = step(
			v,
			mk(v, [I, W9, O], "Weekday"),
			[I, W9.replace("Weekday", "Wee#day"), W9.replace("ridership", "zzzzq"), O],
			"h1",
		);
		assert.equal(x.state, "orphaned");
	});

	for (const [id, was, now, q] of [
		[
			"S1",
			"The mayor said the city council will vote next week on the budget.",
			"The mayor said a final decision is expected next week on the budget.",
			"the city council will vote",
		],
		[
			"S2",
			"Officials confirmed that the old bridge will reopen in May after months of repair work.",
			"Officials confirmed that ferry services will resume in May after months of repair work.",
			"the old bridge will reopen",
		],
	] as const) {
		it(id, () => {
			const v = versions();
			assert.equal(
				step(v, mk(v, [I, was, M, O], q), [I, now, M, O], "h1").state,
				"orphaned",
			);
		});
	}

	for (const [id, q] of [
		["P4", "ighlights feat"],
		["P4c", "the highlight"],
	] as const) {
		it(id, () => {
			const v = versions();
			const PP = "Readers love the highlights feature in this app.";
			const x = step(
				v,
				mk(v, [I, PP, O], q),
				[`${I} Added words here.`, PP, O],
				"h1",
			);
			assert.equal(x.served, q);
			assert.equal(edited(x.row), false);
		});
	}

	it("P5", () => {
		const v = versions();
		const r0 = mk(v, [I, N, O], "old bridge was closed");
		const now = [I, `Far ${N}`, O];
		const t = textOf(now);
		const { basisCandidateId: _b, ...withoutBasis } = r0;
		assert.equal(
			highlightOnPage({ text: t, contentHash: "h1", highlight: r0 }),
			undefined,
		);
		assert.equal(
			storedHighlightState({ highlight: r0, contentHash: "h1" }).state,
			"pending",
		);
		assert.equal(
			highlightOnPage({ text: t, contentHash: "h1", highlight: withoutBasis })
				?.start,
			29,
		);
		const x = step(v, r0, now, "h1");
		assert.equal(x.served, "old bridge was closed");
		assert.equal(x.start, 29);
	});

	it("IS3", () => {
		const v = versions();
		const RL0 = "Release notes, newest first:";
		const RL5 = "Version 2.5 fixes a crash when sharing large files on Android.";
		const RL4 = "Version 2.4 fixes a crash when opening large files on Android.";
		const RL3 = "Version 2.3 fixes a crash when exporting notes on Android.";
		const RL9 = "Older releases are listed on the archive page.";
		const x = step(v, mk(v, [RL0, RL4, RL3, RL9], RL4), [RL0, RL5, RL4, RL3, RL9], "h1");
		assert.equal(x.served, RL4);
		assert.equal(edited(x.row), false);
	});

	it("TT2", () => {
		const v = versions();
		const TR = (t: string) =>
			`The express to the coast departs at ${t} from platform nine and calls at all stations on the line.`;
		const H = "Departures from the central station on Monday morning are listed below.";
		const ZZ = "Services may change at short notice, so check the boards on the day.";
		const x1 = step(
			v,
			mk(v, [H, `${TR("10:05")} ${TR("11:05")}`, ZZ], "departs at 10:05 from platform nine"),
			[H, TR("11:05"), ZZ],
			"h1",
		);
		const x2 = step(v, x1.row, [H, TR("11:07"), ZZ], "h2");
		assert.equal(x1.served, null);
		assert.equal(x2.served, null);
	});

	it("SH1", () => {
		const v = versions();
		const P = [
			"W9zx waax by w60x by w7x a that it the w3cx that. To for w8vx with was is w2ax w5dx and that wpx. W8kx with w7wx w5fx w0x w84x a w1qx of on w5lx the and a.",
			"W3vx w6sx w9x w71x w68x w5jx of w9px at. W8yx w7bx by wa2x in wtx is w8tx.",
			"W77x w20x w7px is on w7tx w97x of. W3jx w2dx to w31x and that was w1ox.",
			"W6lx w3lx w5zx the w61x it w5qx w7ox on of w3ex w4jx w12x was. W7ax is w5tx wa4x w9kx to w9dx as.",
			"W3px w7kx on a it for and w2lx. W6cx w24x that on w42x w2ux w8yx to a whx w34x wkx.",
			"W9px w5bx w71x w2sx w2wx and on wlx the that for. Warx wux w35x w4nx w8tx to a with.",
			"W1xx that wavx w9mx w7gx it w94x w21x w6nx in w71x w1wx. Wkx w6jx wawx w1sx w46x of at w8jx w8ox w2vx w3nx a w1zx.",
			"In w7px w9sx is w8zx w6jx wakx w5hx w2px wacx w5mx w7zx wamx. W2qx of in it for wsx w9ax w10x at. W3hx wa0x the to w6x w1bx w86x in was w2ax walx w4dx.",
			"To w1ux w7vx with by w2jx wnx is to w52x a w5x for. W92x with w7ax at was a w6xx w75x in w2qx with w9mx at. W4ex the wsx of wagx w2xx w6xx w4ox to w5px.",
			"W2wx w72x for w3nx w57x w9sx of to wa6x w2ex. W9sx w21x the was w9ux w4ox on w65x in.",
			"W3vx that for wwx the at w3jx a by w2vx w1px. Is on w64x the w3gx w33x wsx w9dx at w47x with wa1x and in. The as w6nx w87x w2ox w9cx at a with was that w2ex wcx whx.",
			"W6mx wasx a is and of to w6cx. W5nx w3dx w1sx for w84x w9ex w1nx w9ux on was w1gx a wazx. By wazx w6wx w54x a walx w6ix to w6gx is a.",
		];
		const q = "it for and w2lx.";
		const order = [0, 10, 6, 9, 3, 1, 7, 5, 8, 2, 4, 11];
		const t0 = textOf(P);
		const s = t0.indexOf(P[4]) + P[4].indexOf(q);
		const row = mkT({ v, text: t0, start: s, end: s + q.length });
		const x = step(v, row, order.map((i) => P[i]), "h1");
		assert.equal(x.served, q);
		assert.equal(x.start, 1173);
	});
});

describe("re-anchoring, round 10", () => {
	const CAROL = "Carol Diaz was elected to the council in 2023.";
	const Z1 = "市议会昨天通过了新的预算案。";
	const Z2 = "旧桥将于明年春天关闭维修。";
	const Z3 = "居民对此表示欢迎。";
	const Z4 = "读者来信询问旧桥的历史。";
	const NW = N.replace("autumn", "winter");
	const V2 = "The vote was close in 2019 too.";
	const PARK = "Volunteers were thanked for their work in the park.";
	const PARK2 =
		"Later that day volunteers were thanked for their work in the garden by the mayor.";
	const LONG =
		"The final vote was very close indeed, said the mayor on Tuesday after a long night of counting.";
	const T = "Title line stands alone.";
	const FA = "The ferry leaves the north pier at nine.";
	const FB = "Tickets are sold on board only.";
	const NOTICE = "A long notice was added here about the timetable change today.";
	const W2 =
		"Weekday ridership has passed the forecasts made five years ago, and traffic on the avenue has fallen by a fifth.";
	const A2 = "The final vote in the council chamber was close.";
	const AB2C = VOTE_CRITICS.replace(
		"The vote was close",
		"The final vote in the council chamber was close",
	);

	const fixtures: readonly (readonly [
		string,
		readonly string[],
		string,
		number,
		readonly (readonly string[])[],
		readonly string[],
	])[] = [
		["SIB1, SIB1.2", [I, ALICE, M, BOB, ME, DT, O], ELECTED, 0, [[I, M, ME, DT, BOB, O], [I, ALICE, M, BOB, ME, DT, O]], ["orphaned", "anchored@28"]],
		["SIB3", [I, ALICE, M, BOB, ME, DT, O], ELECTED, 0, [[I, "Smith, a newcomer, took her seat last year.", M, ME, DT, BOB, O]], ["orphaned"]],
		["ZXN", [I, Z1 + Z2 + Z3, O], "旧桥", 0, [[I, Z1 + Z3 + Z4, O]], ["orphaned"]],
		["P3n", [I, M, ME, DT, N, O], BQ, 0, [[N, I, M, ME, N, DT, O]], ["moved@129"]],
		["CS1", [I, VOTE, M, V2, ME, DT, O], VQ, 0, [[I, M, V2.replace("2019", "2020"), ME, DT, O]], ["orphaned"]],
		["NC1", [I, PARK, M, PARK2, O], "thanked for their work in the park", 0, [[I, M, PARK2.replace("garden", "park"), O]], ["orphaned"]],
		["NA3", [I, VOTE, O], VQ, 0, [[I, LONG, O]], ["moved@22e"]],
		["NA4", [I, VOTE, M, O], VQ, 0, [[I, M, LONG, O]], ["moved@49e"]],
		["CNT1", [T, FA, FB, FA, FB, O], "ferry leaves the north pier", 1, [[T, NOTICE, FA, FB, "Second new line.", FA, FB, O]], ["moved@92"]],
		["WS1", [I, W2, O], "has passed", 0, [[I, W2.replace("passed", "p#ssed"), W2.replace("ridership", "zzzzq"), O]], ["moved@30e"]],
		["P3c", [I, N, M, ME, DT, O], BQ, 0, [[I, M, ME, NW, DT, NW, O]], ["orphaned"]],
		["P1r.1, P1r.2", [I, `${A2} ${CRITICS}`, M, ME, DT, O], "final vote in the council chamber was close", 0, [[I, `${A2.replace("close", "tight")} ${CRITICS}`, M, ME, DT, O], [I, M, ME, DT, AB2C, O]], ["moved@16e", "orphaned"]],
		["ZP", [I, Z1 + Z2 + Z3, M, O], "旧桥", 0, [[I, Z1 + Z3, M, Z2 + Z4.replace("旧桥", "新路"), O]], ["moved@63"]],
		["SIB2", [I, ALICE, M, ME, DT, O], ELECTED, 0, [[I, M, ME, DT, CAROL, O]], ["moved@105"]],
		["SIB5", [I, VOTE, M, V2, ME, DT, O], VQ, 0, [[I, M, ME, DT, V2, O]], ["orphaned"]],
	];

	for (const [id, basis, quote, nth, steps, wants] of fixtures) {
		it(id, () => {
			const v = versions();
			assert.deepEqual(
				chain({ v, row: mk(v, basis, quote, { nth }), versions: steps, withReason: false }),
				wants,
			);
		});
	}
});

describe("re-anchoring, round 11", () => {
	const BRUCE = "Bruce Jones was elected to the council in 2021.";
	const SB = "The council approved the bridge after a long debate.";
	const X = "Residents near the bridge complained about noise.";
	const H2 = " लोग अपने घरों में ही रहे और बाहर नहीं निकले।";
	const C2 = "人们都留在家里没有出门。";
	const TH =
		"รัฐบาลประกาศมาตรการใหม่เพื่อช่วยเหลือประชาชนที่ได้รับผลกระทบจากน้ำท่วม";

	const fixtures: readonly (readonly [
		string,
		readonly string[],
		string,
		number,
		readonly (readonly string[])[],
		readonly string[],
	])[] = [
		["SWAP1", [I, ALICE, M, ME, BOB, O], ELECTED, 0, [[I, BOB, M, ME, ALICE, O]], ["moved@124"]],
		["SWAP2", [I, ALICE, M, ME, BOB, O], "Alice Smith was elected", 0, [[I, BOB, M, ME, ALICE, O]], ["moved@108"]],
		["SWAP3", [I, ALICE, M, ME, BRUCE, O], ELECTED, 0, [[I, BRUCE, M, ME, ALICE, O]], ["moved@126"]],
		["SWAP4", [I, ALICE, M, ME, BOB, O], ELECTED, 1, [[I, BOB, M, ME, ALICE, O]], ["moved@26"]],
		["SWAP5.1, SWAP5.2", [I, ALICE, M, ME, BOB, O], "Alice Smith was elected", 0, [[I, BOB, M, ME, ALICE, O], [I, M, ME, ALICE, O]], ["moved@108", "moved@62"]],
		["SWAP9", [I, ALICE, M, ME, BOB, O], ELECTED, 0, [[I, BOB, M, ME, ALICE.replace("2019", "2020"), O]], ["moved@124"]],
		["RMX1", [I, SB, M, ME, DT, O], "bridge", 0, [[I, X, M, ME, SB, DT, O]], ["moved@137"]],
		["RMX2", [I, SB, M, ME, DT, O], "the bridge", 0, [[I, X, M, ME, SB, DT, O]], ["moved@133"]],
		["RMX3", [I, GATE, M, ME, DT, O], GQ, 0, [[I, TOURISTS, M, ME, GATE, DT, O]], ["moved@137"]],
		["RMX4c", [I, GATE, M, ME, DT, O], GQ, 0, [[I, TOURISTS, M, ME, DT, O]], ["moved@33"]],
		["RMX5", [I, M, ME, GATE, DT, O], GQ, 0, [[I, GATE, M, ME, TOURISTS, DT, O]], ["moved@36"]],
		["RMX6.1, RMX6.2", [I, GATE, M, ME, DT, O], GQ, 0, [[I, TOURISTS, M, ME, GATE, DT, O], [I, M, ME, GATE, DT, O]], ["moved@137", "moved@86"]],
		["RMX8", [GATE, M, ME, DT, O], GQ, 0, [[TOURISTS, M, GATE, ME, DT, O]], ["moved@102"]],
		["RMX9c", [GATE, M, ME, DT, O], GQ, 0, [[TOURISTS, GATE, M, ME, DT, O]], ["moved@75"]],
		["SWAP8", [I, ALICE, M, ME, BOB, O], ELECTED, 0, [[I, BOB.replace("2021", "2022"), M, ME, ALICE.replace("2019", "2020"), O]], ["moved@26"]],
		["RMX7", [I, GATE, M, ME, DT, O], GQ, 0, [[I, TOURISTS, M, ME, GATE.replace("after the quake", "after last week's quake"), DT, O]], ["moved@33"]],
		["P1L", [I, `${CRITICS} ${VOTE}`, M, ME, DT, O], VQ, 0, [[I, M, ME, DT, CRITICS_VOTE, O]], ["moved@174"]],
		["P1Lc", [I, `${CRITICS} ${VOTE}`, M, ME, DT, O], VQ, 0, [[I, CRITICS_VOTE, M, ME, DT, O]], ["moved@96"]],
		["P2L", [I, CRITICS_VOTE, M, ME, DT, O], VQ, 0, [[I, M, ME, DT, `${CRITICS} ${VOTE}`, O]], ["moved@170"]],
		["P1H", [I, VOTE, M, ME, DT, O], VQ, 0, [[I, M, ME, DT, "However, the vote was close in the end, said the mayor on Tuesday after a long night of counting.", O]], ["moved@103"]],
		["HI2", [I, `कल शहर में भारी बारिश हुई।${H2}`, O], "शहर में भारी", 0, [[I, `आज बाजार में भारी भीड़ रही।${H2}`, O]], ["orphaned"]],
		["ZH4", [I, `昨天城里下了大雨。${C2}`, O], "城里下了大", 0, [[I, `今天市场里来了大批人。${C2}`, O]], ["orphaned"]],
		["TH5", [I, TH, O], "ช่วยเหลือประชาชน", 0, [[I, TH.replace("ประชาชน", "ชาวบ้าน"), O]], ["moved@40e"]],
	];

	for (const [id, basis, quote, nth, steps, wants] of fixtures) {
		it(id, () => {
			const v = versions();
			assert.deepEqual(
				chain({ v, row: mk(v, basis, quote, { nth }), versions: steps, withReason: false }),
				wants,
			);
		});
	}

	it("TH5.words", () => {
		const v = versions();
		const x = step(
			v,
			mk(v, [I, TH, O], "ช่วยเหลือประชาชน"),
			[I, TH.replace("ประชาชน", "ชาวบ้าน"), O],
			"h1",
		);
		assert.equal(x.served, "ช่วยเหลือชาวบ้าน");
	});

	it("CORR1", () => {
		const index = createWordIndex();
		assert.ok(
			index.corr({
				a: index.words("counting"),
				b: index.words("count"),
				plain: true,
			}) <= 1,
		);
	});

	it("CK1", () => {
		const v = versions();
		const LB = textOf([
			"Live updates from the count:",
			"10:42 The returning officer said turnout in the northern wards was 61%, up four points on last time.",
			"10:15 The returning officer said turnout in the southern wards was 58%, down two points on last time.",
			"09:50 Counting began at the leisure centre after a short delay caused by a missing ballot box.",
			"09:20 Candidates arrived at the leisure centre, where staff were still setting out tables.",
			"That is all for now.",
		]);
		const blur = (x: string) => x.replace(/[A-Za-z0-9]/g, "x");
		const s = 426;
		const e = 433;
		const rewritten =
			LB.slice(0, Math.max(0, s - 36)) +
			blur(LB.slice(Math.max(0, s - 36), s)) +
			LB.slice(s, e) +
			blur(LB.slice(e, e + 36)) +
			LB.slice(e + 36);
		const x = stepText({
			v,
			row: mkT({ v, text: LB, start: s, end: e }),
			text: `${rewritten}\nUpdate: officials later repeated that all for remained the plan.`,
			hash: "h1",
		});
		assert.equal(outcome(x, false), "anchored@426");
	});

	it("WS2", () => {
		const v = versions();
		const t0 = textOf([
			I,
			"The council voted to approve the new housing plan on Monday.",
			O,
		]);
		const s = t0.indexOf("approve the new housing plan");
		const x = step(
			v,
			mkT({ v, text: t0, start: s, end: s + 28 }),
			[I, "The council voted to approve the new", "housing plan on Monday.", O],
			"h1",
		);
		assert.equal(outcome(x, false), "anchored@33");
	});
});

describe("re-anchoring, round 12", () => {
	const PQ = "We never expected the river to rise that fast.";
	const BODY = `Flooding began on Tuesday night. ${PQ} Many families left the valley.`;
	const NO = "Did the first pump work? It did not.";
	const TRY =
		"The team tried again in March. It did not. The second pump failed twice.";
	const Z1 = "他居然赢了！！大家都很惊讶。";
	const ZM = "天气一直很好。";
	const Z2 = "真的假的！！我不敢相信。";
	const BRG =
		"The bridge opened in May after two years of delays and cost overruns. Traffic doubled within a year, and the city now plans a second crossing.";
	const SH = "It rained.";
	const AL2 = ALICE.replace("2019", "2020");
	const G2 = GATE.replace("after the quake", "after last week's quake");

	const fixtures: readonly (readonly [
		string,
		readonly string[],
		string,
		number,
		readonly (readonly string[])[],
		readonly string[],
	])[] = [
		["CX1.1, CX1.2", [I, PQ, M, ME, BODY, DT, O], "the river to rise", 1, [[I, M, ME, BODY, DT, PQ, O], [I, M, ME, BODY, DT, O]], ["moved@113", "anchored@113"]],
		["CX2.1", [I, BODY, M, ME, PQ, DT, O], "the river to rise", 0, [[I, PQ, BODY, M, ME, DT, O]], ["moved@110"]],
		["CX3.1", [I, NO, M, ME, TRY, DT, O], "tried again in March. It did not. The second pump failed", 0, [[I, M, ME, TRY, DT, NO, O]], ["moved@71"]],
		["CX5.1", [I, Z1, ZM, Z2, O], "真的假的！！我不敢", 0, [[I, ZM, Z2, Z1, O]], ["moved@20"]],
		["CX4.1", [I, BRG, M, SH, DT, O], "opened in May after two years of delays and cost overruns. Traffic doubled within a year", 0, [[I, BRG.replace("overruns. ", `overruns. ${SH} `), M, DT, O]], ["moved@23e"]],
		["SW2S.1", [I, ALICE, M, ME, BOB, O], "council in 2019.\nWeather was mild", 0, [[I, BOB, M, ME, ALICE, O]], ["orphaned (notPlaced)"]],
		["CX6.1, CX6.2", [I, GATE, M, ME, DT, O], GQ, 0, [[I, TOURISTS, M, ME, G2, DT, O], [I, M, ME, G2, DT, O]], ["moved@33", "orphaned (gone)"]],
		["CX7.1, CX7.2", [I, ALICE, M, ME, BOB, O], ELECTED, 0, [[I, BOB.replace("2021", "2022"), M, ME, AL2, O], [I, M, ME, AL2, O]], ["moved@26", "orphaned (gone)"]],
		["B1a.1", [I, `${CRITICS} ${VOTE}`, M, ME, DT, O], "The vote was close", 0, [[I, M, ME, DT, CRITICS_VOTE, O]], ["orphaned (gone)"]],
		["B1c.1", [I, CRITICS_VOTE, M, ME, DT, O], "the vote was close", 0, [[I, M, ME, DT, `${CRITICS} ${VOTE}`, O]], ["orphaned (gone)"]],
	];

	for (const [id, basis, quote, nth, steps, wants] of fixtures) {
		it(id, () => {
			const v = versions();
			assert.deepEqual(
				chain({ v, row: mk(v, basis, quote, { nth }), versions: steps }),
				wants,
			);
		});
	}
});

const ED_SENTENCES = {
	ED1: "We never expected the creek to rise that fast.",
	ED2: "We never expected the river to climb that fast.",
	ED3: "We never expected the river to rise so quickly.",
	ED5: "Nobody had seen the river rise that fast.",
} as const;

type CopyFixture = readonly [
	string,
	readonly string[],
	number,
	readonly string[],
];

function edFixtures(): CopyFixture[] {
	return Object.entries(ED_SENTENCES).flatMap(([id, wn]): CopyFixture[] => {
		const bn = `${A} ${wn} ${MF}`;
		return [
			[`${id}a`, [I, B0, M, ME, W, DT, O], 0, [I, bn, M, ME, W, DT, O]],
			[`${id}b`, [I, W, M, B0, ME, DT, O], 1, [I, W, M, bn, ME, DT, O]],
			[`${id}c`, [I, W, M, ME, B0, DT, O], 1, [I, M, W, ME, bn, DT, O]],
		];
	});
}

const ROUND13: readonly (readonly [...CopyFixture, string])[] = [
	["DK1", [I, BW, M, ME, DT, O], 0, [I, W, BW, M, ME, DT, O], "moved@77"],
	["DK2", [I, W, BW, M, ME, DT, O], 1, [I, BW, M, ME, DT, O], "moved@30"],
	["PB1", [I, M, W, BW, ME, DT, O], 1, [I, M, BW, ME, DT, W, O], "moved@57"],
	["PB2", [I, W, M, ME, BW, DT, O], 1, [I, M, ME, W, BW, DT, O], "anchored@127"],
	["PB3", [I, M, W, BW, ME, DT, O], 1, [I, M, BW, ME, DT, O], "moved@57"],
	["MA1", [I, BW, M, ME, W, DT, O], 0, [I, M, ME, BW, DT, O], "moved@80"],
	["MA2", [I, W, M, ME, BW, DT, O], 1, [I, BW, M, ME, DT, O], "moved@30"],
	["MA3", [I, BW2, M, ME, W, DT, O], 0, [I, M, ME, BW2, DT, O], "moved@111"],
	["GC0", [I, B0, M, ME, DT, O], 0, [I, AM, M, ME, DT, U, O], "orphaned (gone)"],
	["GC1a", [I, B0, M, ME, W, DT, O], 0, [I, AM, M, ME, DT, U, O], "orphaned (gone)"],
	["GC1b", [I, W, M, B0, ME, DT, O], 1, [I, M, AM, ME, DT, U, O], "orphaned (gone)"],
];

const ED_WANTS: Record<string, string> = {
	ED1a: "moved@75e",
	ED1b: "moved@149e",
	ED1c: "moved@172e",
	ED2a: "moved@75e",
	ED2b: "moved@149e",
	ED2c: "moved@172e",
	ED3a: "anchored@75",
	ED3b: "anchored@149",
	ED3c: "anchored@172",
	ED5a: "moved@73e",
	ED5b: "moved@147e",
	ED5c: "moved@170e",
};

describe("re-anchoring, round 13", () => {
	for (const [id, basis, nth, paras, want] of ROUND13) {
		it(id, () => {
			assert.equal(outcome(go(basis, nth, paras)), want);
		});
	}

	for (const [id, basis, nth, paras] of edFixtures()) {
		it(id, () => {
			assert.equal(outcome(go(basis, nth, paras)), ED_WANTS[id]);
		});
	}

	it("K3", () => {
		const S1 = "The mayor spoke first.";
		const T1 = "The crowd cheered for the new bridge plan.";
		const F1 = "Later the crowd jeered at the new tax plan.";
		const v = versions();
		const x = step(
			v,
			mk(
				v,
				[I, `${S1} ${T1}`, M, ME, F1, DT, O],
				"spoke first. The crowd cheered for the new bridge",
			),
			[I, `${S1} ${F1}`, M, ME, DT, O],
			"h1",
		);
		assert.equal(outcome(x), "orphaned (notPlaced)");
	});
});

const ROUND14: readonly (readonly [...CopyFixture, string])[] = [
	["C.MV1", [I, B0, M, ME, W, DT, O], 0, [I, M, ME, W, DT, BN1, O], "moved@200e"],
	["C.MV2", [I, W, M, B0, ME, DT, O], 1, [I, W, M, ME, DT, BN1, O], "moved@200e"],
	["C.H2a", [I, B0, M, ME, W, DT, O], 0, [I, BN2, M, ME, W, DT, O], "orphaned (notPlaced)"],
	["C.H2b", [I, W, M, B0, ME, DT, O], 1, [I, W, M, BN2, ME, DT, O], "orphaned (notPlaced)"],
	["C.MV1n", [I, B0, M, ME, DT, O], 0, [I, M, ME, DT, BN1, O], "moved@153e"],
	["C.MV2n", [I, M, B0, ME, DT, O], 0, [I, M, ME, DT, BN1, O], "moved@153e"],
	["C.MV4", [I, B0, M, ME, W, DT, O], 1, [I, M, ME, W, DT, BN1, O], "moved@80"],
	["C.MV4n", [I, AM, M, ME, W, DT, O], 0, [I, M, ME, W, DT, AM, O], "moved@80"],
	["C.MV5", [I, W, M, ME, B0, DT, O], 1, [I, M, W, ME, DT, BN1, O], "moved@200e"],
	["C.MV5n", [I, M, ME, B0, DT, O], 0, [I, M, ME, DT, BN1, O], "moved@153e"],
	["C.H2n", [I, B0, M, ME, DT, O], 0, [I, BN2, M, ME, DT, O], "orphaned (notPlaced)"],
	["C.H2bn", [I, M, B0, ME, DT, O], 0, [I, M, BN2, ME, DT, O], "orphaned (notPlaced)"],
	["C.H2cn", [I, M, ME, B0, DT, O], 0, [I, M, ME, BN2, DT, O], "orphaned (notPlaced)"],
	["C.H2m", [I, W, M, ME, B0, DT, O], 0, [I, M, ME, BN2, DT, W, O], "moved@228"],
	["C.H2mn", [I, W, M, ME, BN2, DT, O], 0, [I, M, ME, BN2, DT, W, O], "moved@228"],
	["C.H2mz", [I, W, M, ME, B0, DT, O], 0, [I, Z, M, ME, BN2, DT, W, O], "moved@275"],
	["C.H2mzn", [I, W, M, ME, BN2, DT, O], 0, [I, Z, M, ME, BN2, DT, W, O], "moved@275"],
	["C.H2c", [I, W, M, ME, B0, DT, O], 1, [I, M, W, ME, BN2, DT, O], "moved@57"],
	["C.MV3", [I, B0, M, ME, W, DT, O], 0, [I, M, ME, DT, BN1, O], "orphaned (gone)"],
];

describe("re-anchoring, round 14", () => {
	for (const [id, basis, nth, paras, want] of ROUND14) {
		it(id, () => {
			assert.equal(outcome(go(basis, nth, paras)), want);
		});
	}

	const copies: CopyFixture[] = [
		...ROUND13.filter(([id]) => id !== "GC0").map(
			([id, basis, nth, paras]): CopyFixture => [id, basis, nth, paras],
		),
		...edFixtures(),
		...ROUND14.filter(([, basis]) => basis.includes(W)).map(
			([id, basis, nth, paras]): CopyFixture => [id, basis, nth, paras],
		),
	];
	const allowed = new Set(["C.MV3", "C.H2c"]);

	for (const [id, basis, nth, paras] of copies) {
		let k = 0;
		let at = -1;
		for (let i = 0; i < basis.length && at < 0; i++) {
			const n = basis[i].split(Q).length - 1;
			if (nth < k + n) at = i;
			else k += n;
		}
		if (basis[at] === W) continue;
		const twinNth = nth - basis.slice(0, at).filter((p) => p === W).length;
		const twin = () =>
			view(
				go(
					basis.filter((p) => p !== W),
					twinNth,
					paras.filter((p) => p !== W),
				),
			);
		if (allowed.has(id)) {
			it(`TWIN.${id} differs from its twin, as the owner allowed`, () => {
				assert.notEqual(view(go(basis, nth, paras)), twin());
			});
		} else {
			it(`TWIN.${id}`, () => {
				assert.equal(view(go(basis, nth, paras)), twin());
			});
		}
	}
});

describe("re-anchoring, round 15", () => {
	const WC = "we never expected the river to rise that fast.";
	const WN = "We never expected the river to rise this fast.";
	const WQ = "“We never expected the river to rise that fast.”";
	const WP = "We never expected the river to rise that fast";
	const W2 = "We never expected the river to rise that quickly.";
	const W3 = "We never, ever expected the river to rise that fast.";
	const P4S = `${A} Nobody predicted such a sudden flood. ${MF}`;

	const fixtures: readonly (readonly [...CopyFixture, string, string | null])[] = [
		["P8", [I, B0, M, ME, WQ, DT, O], 0, [I, AM, M, ME, WQ, DT, O], "moved@157", WQ],
		["P9", [I, B0, M, ME, WP, DT, O], 0, [I, AM, M, ME, WP, DT, O], "moved@156", WP],
		["P9c", [I, B0, M, ME, WC, DT, O], 0, [I, AM, M, ME, WC, DT, O], "moved@156", WC],
		["P1", [I, B0, M, ME, WC, DT, O], 0, [I, M, ME, WC, DT, BN1, O], "moved@200e", WC],
		["P10", [I, B0, M, ME, WQ, DT, O], 0, [I, M, ME, WQ, DT, BN1, O], "moved@202e", WQ],
		["T3", [I, B0, M, ME, WQ, DT, O], 0, [I, M, ME, WP, DT, BN1, O], "moved@199e", null],
		["T3b", [I, B0, M, ME, W, DT, O], 0, [I, M, ME, WC, DT, BN1, O], "moved@200e", null],
		["T1", [I, B0, M, ME, W, DT, O], 0, [I, M, ME, W2, DT, BN1, O], "orphaned (gone)", null],
		["T2", [I, B0, M, ME, W, DT, O], 0, [I, M, ME, W3, DT, BN1, O], "orphaned (gone)", null],
		["T5", [I, B0, M, ME, W, DT, O], 0, [I, M, ME, DT, BN1, O], "orphaned (gone)", null],
		["P2", [I, B0, M, ME, WN, DT, O], 0, [I, M, ME, WN, DT, BN1, O], "orphaned (gone)", null],
		["P4", [I, B0, M, ME, W, DT, O], 0, [I, P4S, M, ME, W, DT, O], "orphaned (notPlaced)", W],
		["P4n", [I, B0, M, ME, DT, O], 0, [I, P4S, M, ME, DT, O], "orphaned (notPlaced)", null],
	];

	for (const [id, basis, nth, paras, want] of fixtures) {
		it(id, () => {
			assert.equal(outcome(go(basis, nth, paras)), want);
		});
	}

	const twins: Record<string, readonly [string, string]> = {
		T3: [WQ, WP],
		T3b: [W, WC],
	};
	const allowed = new Set(["P8", "P9", "P9c"]);

	for (const [id, basis, nth, paras, , copy] of fixtures) {
		const removed = twins[id] ?? (copy === null ? undefined : [copy, copy]);
		if (removed === undefined) continue;
		const [cb, cn] = removed;
		const twin = () =>
			view(
				go(
					basis.filter((p) => p !== cb),
					nth,
					paras.filter((p) => p !== cn),
				),
			);
		if (allowed.has(id)) {
			it(`TWIN.${id} differs from its twin, as the owner allowed`, () => {
				assert.notEqual(view(go(basis, nth, paras)), twin());
			});
		} else {
			it(`TWIN.${id}`, () => {
				assert.equal(view(go(basis, nth, paras)), twin());
			});
		}
	}

	function sweepRow(params: {
		t0: string;
		s: number;
		e: number;
		t: string;
	}): string {
		const v = versions();
		const row = mkT({ v, text: params.t0, start: params.s, end: params.e });
		return outcome(stepText({ v, row, text: params.t, hash: "h1" }));
	}

	it("SW.repeat", () => {
		assert.equal(
			sweepRow({
				t0: "The council met for its final session of the year.\nOn Monday the committee passed the budget for road repairs after a long debate. On Tuesday the committee passed the budget for the new schools without objection. On Tuesday the committee passed the budget despite loud protests from residents. On Friday the committee passed the motion on parking fees after a short recess.\nThe session closed at noon.",
				s: 0,
				e: 44,
				t: "The council met for its final session of the year#\nOn Monday the committee passed the budget for road repairs after a long debate. On Tuesday the committee passed the budget for the new schools without objection. On Tuesday the committee passed the budget despite loud protests from residents. On Friday the committee passed the motion on parking fees after a short recess.\nThe session closed at noon.\nThe council met for its final session of the year.",
			}),
			"anchored@0",
		);
	});

	it("SW.sibling", () => {
		assert.equal(
			sweepRow({
				t0: "The company published its results after the market closed.\nSales were steady through spring. Q1 revenue rose 3% to $1 billion, the company said on Tuesday. Q2 revenue rose 4% to $1.1 billion, the company said on Tuesday. Q3 revenue rose 12% to $3.9 billion, the company said on Tuesday. Q4 revenue rose 7% to $1.4 billion, the company said on Tuesday. Analysts were unmoved.\nShares closed flat on the day.",
				s: 112,
				e: 138,
				t: "The company published its results after the market closed.\nSales were steady through spring. Q1 revenue rose 3% to $1 billion# the company said on Tuesday. Q2 revenue rose 4% to $2 billion, the company said on Tuesday. Q2 revenue rose 4% to $1.1 billion, the company said on Tuesday. Q3 revenue rose 12% to $3.9 billion, the company said on Tuesday. Q4 revenue rose 7% to $1.4 billion, the company said on Tuesday. Analysts were unmoved.\nShares closed flat on the day.",
			}),
			"moved@112e",
		);
	});
});

interface SweepRow {
	t0: string;
	s: number;
	e: number;
	t1: string;
	truth: number;
}

function copySweepRows(): Record<"a" | "b" | "c" | "d" | "e", SweepRow[]> {
	let seed = 7n;
	const rnd = () => {
		seed = (seed * 1103515245n + 12345n) % 2147483648n;
		return Number(seed) / 2147483648;
	};
	const ri = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
	const WL =
		"river valley town bridge market winter summer council mayor school teacher doctor farmer harbour ship train station road field forest mountain village city report budget water power light storm rain wind cloud morning evening night season harvest price wage worker union factory office court judge law vote plan project museum library garden church street house family child parent friend letter story book page paper song music film theatre painter writer engineer bank loan tax trade export import coast island lake north south east west old new small large early late quiet".split(
			" ",
		);
	const sent = () => {
		const n = ri(6, 10);
		const w: string[] = [];
		for (let i = 0; i < n; i++) w.push(WL[ri(0, WL.length - 1)]);
		const s = w.join(" ");
		return `${s[0].toUpperCase()}${s.slice(1)}.`;
	};
	const one = (mode: string): SweepRow => {
		const np = ri(8, 12);
		const bi = ri(1, np - 1);
		const P: string[][] = [];
		for (let i = 0; i < np; i++) {
			const k = i === bi ? ri(2, 3) : ri(1, 3);
			const ss: string[] = [];
			for (let j = 0; j < k; j++) ss.push(sent());
			P.push(ss);
		}
		const S0 = P[bi][ri(0, P[bi].length - 1)];
		const quote = S0.split(" ").slice(1, 5).join(" ");
		const body = P[bi].join(" ");
		const old = P.map((ss) => ss.join(" "));
		old.splice(ri(0, old.length), 0, S0);
		const t0 = textOf(old);
		const s = t0.indexOf(body) + body.indexOf(S0) + S0.indexOf(quote);
		const nw = old.slice();
		const del = (x: string) => {
			nw.splice(nw.indexOf(x), 1);
		};
		const mv = (x: string) => {
			const i = nw.indexOf(x);
			nw.splice(i, 1);
			let j = ri(0, nw.length);
			if (j === i) j = (j + 1) % (nw.length + 1);
			nw.splice(j, 0, x);
		};
		if (mode === "a") {
			del(S0);
			mv(body);
		} else if (mode === "b") {
			mv(S0);
			mv(body);
		} else if (mode === "c") mv(body);
		else if (mode === "d") del(S0);
		else mv(S0);
		const t1 = textOf(nw);
		const truth = t1.indexOf(body) + body.indexOf(S0) + S0.indexOf(quote);
		return { t0, s, e: s + quote.length, t1, truth };
	};
	const rows: Record<"a" | "b" | "c" | "d" | "e", SweepRow[]> = {
		a: [],
		b: [],
		c: [],
		d: [],
		e: [],
	};
	for (const mode of ["a", "b", "c", "d", "e"] as const)
		for (let n = 0; n < 150; n++) rows[mode].push(one(mode));
	return rows;
}

describe("re-anchoring, the copy sweep", () => {
	const rows = copySweepRows();

	function verdict(params: {
		orphaned: boolean;
		start: number;
		truth: number;
	}): string {
		if (params.orphaned) return "G";
		return params.start === params.truth ? "R" : "W";
	}

	const table = {
		a: [150, 0, 0],
		b: [126, 24, 0],
		c: [135, 15, 0],
		d: [150, 0, 0],
		e: [146, 4, 0],
	} as const;

	for (const mode of ["a", "b", "c", "d", "e"] as const) {
		it(`mode ${mode}: every row is placed where today's pass places it`, () => {
			const ours = rows[mode].map((r) => {
				const v = versions();
				const x = stepText({
					v,
					row: mkT({ v, text: r.t0, start: r.s, end: r.e }),
					text: r.t1,
					hash: "h1",
				});
				return verdict({
					orphaned: x.state === "orphaned",
					start: x.start,
					truth: r.truth,
				});
			});
			const today = rows[mode].map((r) => {
				const a = anchorHighlightFuzzy({
					text: r.t1,
					contentHash: "h1",
					highlight: mkT({ v: versions(), text: r.t0, start: r.s, end: r.e }),
				});
				return verdict({
					orphaned: a.anchorState === "orphaned",
					start: a.start,
					truth: r.truth,
				});
			});
			assert.equal(ours.join(""), today.join(""));
			assert.deepEqual(
				["R", "W", "G"].map((k) => ours.filter((x) => x === k).length),
				table[mode],
			);
		});
	}
});

describe("re-anchoring, the seeded shuffle", () => {
	for (const [lo, hi] of [
		[1, 1],
		[1, 3],
		[2, 3],
	] as const) {
		it(`places every four-word highlight right when ${lo}-${hi} sentence paragraphs are shuffled`, () => {
			let seed = 11;
			const rnd = () => {
				seed = (seed * 48271) % 2147483647;
				return seed / 2147483647;
			};
			const pick = (a: readonly string[]) => a[Math.floor(rnd() * a.length)];
			const FUNCTION = ["the", "of", "and", "to", "in", "a", "is", "that", "for", "it", "on", "with", "as", "was", "at", "by"];
			const CONTENT = Array.from({ length: 400 }, (_, i) => `w${i.toString(36)}x`);
			const sentence = () => {
				const w = Array.from({ length: 8 + Math.floor(rnd() * 7) }, () =>
					rnd() < 0.45 ? pick(FUNCTION) : pick(CONTENT),
				);
				return `${w[0][0].toUpperCase()}${w.join(" ").slice(1)}.`;
			};
			const tally: Record<string, number> = {};
			for (let trial = 0; trial < 300; trial++) {
				const paras = Array.from({ length: 12 }, () =>
					Array.from({ length: lo + Math.floor(rnd() * (hi - lo + 1)) }, sentence).join(" "),
				);
				const k = Math.floor(rnd() * 12);
				const ws = paras[k].split(" ");
				const at = Math.floor(rnd() * (ws.length - 3));
				const quote = ws.slice(at, at + 4).join(" ");
				const t0 = textOf(paras);
				const s = t0.indexOf(paras[k]) + (at > 0 ? ws.slice(0, at).join(" ").length + 1 : 0);
				const v = versions();
				const row = mkT({ v, text: t0, start: s, end: s + quote.length });
				const order = paras.map((_, i) => i);
				for (let i = order.length - 1; i > 0; i--) {
					const j = Math.floor(rnd() * (i + 1));
					[order[i], order[j]] = [order[j], order[i]];
				}
				const t1 = textOf(order.map((i) => paras[i]));
				const want = t1.indexOf(paras[k]) + (s - t0.indexOf(paras[k]));
				const x = stepText({ v, row, text: t1, hash: "h1" });
				const got =
					x.state === "orphaned"
						? `not found ${x.reason}`
						: x.start === want && x.served === quote
							? "right"
							: "wrong";
				tally[got] = (tally[got] ?? 0) + 1;
			}
			assert.deepEqual(tally, { right: 300 });
		});
	}
});

describe("re-anchoring, the worst case", () => {
	it("refuses a highlight between two unrelated bodies of about 69,000 characters", () => {
		let seed = 7;
		const rnd = () => {
			seed = (seed * 48271) % 2147483647;
			return seed / 2147483647;
		};
		const vocab = Array.from({ length: 2000 }, (_, i) => `w${i.toString(36)}`);
		const body = () =>
			Array.from(
				{ length: 1300 },
				() =>
					`${Array.from({ length: 12 }, () => vocab[Math.floor(rnd() * vocab.length)]).join(" ")}.`,
			).join(" ");
		const before = body();
		const after = body();
		const s = before.indexOf(" ", 40000) + 1;
		const e = before.indexOf(" ", s + 30);
		const v = versions();
		const row: Row = {
			exact: before.slice(s, e),
			prefix: "",
			suffix: "",
			start: s,
			end: e,
			anchorState: "anchored",
			anchoredContentHash: "h0",
			orderKey: s,
			anchorRevision: 0,
			basisCandidateId: addVersion(v, before),
		};
		assert.equal(
			outcome(stepText({ v, row, text: after, hash: "h1" })),
			"orphaned (notPlaced)",
		);
	});
});
