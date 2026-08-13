import assert from "node:assert";
import { z } from "zod";

/** The info string that opts a fenced block into a figure. */
export const FIGURE_FENCE = "rp-figure";

const FIELD_SEPARATOR = " | ";
const CELL_SEPARATOR = ">>";

/** Every interactive figure is driven by native inputs and `:has()` rules that
 * live in the one stylesheet, not in per-figure `<style>` blocks. Those rules
 * enumerate positions, so each kind has a ceiling the stylesheet was written to
 * cover. Raising one means adding the matching rules in blog.styles.css. */
export const MAX_WHENS = 4;
export const MAX_STEPS = 10;

/** One `key: value` line. A key may repeat, which is how a figure carries a list
 * of rows or steps without nesting — the fence body has to stay legible as prose
 * in the `text/markdown` representation, where a nested format would not. */
interface Line {
	key: string;
	value: string;
}

function readLines(body: string): Line[] {
	const lines: Line[] = [];
	for (const raw of body.split("\n")) {
		const text = raw.trim();
		if (text === "") continue;
		const colon = text.indexOf(":");
		assert(colon > 0, `rp-figure: line is not "key: value" — ${text}`);
		lines.push({ key: text.slice(0, colon).trim(), value: text.slice(colon + 1).trim() });
	}
	return lines;
}

function one(lines: Line[], key: string): string {
	const found = lines.filter((line) => line.key === key);
	assert(found.length === 1, `rp-figure: expected exactly one "${key}:" line, found ${found.length}`);
	return found[0].value;
}

function optional(lines: Line[], key: string): string | undefined {
	const found = lines.filter((line) => line.key === key);
	assert(found.length <= 1, `rp-figure: "${key}:" may appear at most once`);
	return found[0]?.value;
}

function many(lines: Line[], key: string): string[] {
	return lines.filter((line) => line.key === key).map((line) => line.value);
}

function fields(value: string, count: number, context: string): string[] {
	const parts = value.split(FIELD_SEPARATOR).map((part) => part.trim());
	assert(
		parts.length === count,
		`rp-figure: ${context} needs ${count} fields separated by " | ", got ${parts.length} — ${value}`,
	);
	return parts;
}

const Num = z.coerce.number().finite();

/** Bars: independent before/after measures, one row each. Each row is scaled to
 * its own larger value because the measures share no unit, and both values are
 * printed so the scaling can never be the only thing carrying the number. */
export interface BarsFigure {
	kind: "bars";
	title: string;
	note?: string;
	beforeLabel: string;
	afterLabel: string;
	rows: {
		label: string;
		before: { value: number; text: string };
		after: { value: number; text: string };
	}[];
}

/** Walk: a chain whose stages can refuse. `refuses` says where the payload falls
 * back to, which is the claim prose serves worst across several stages. */
export interface WalkFigure {
	kind: "walk";
	title: string;
	note?: string;
	toggle: string;
	steps: { name: string; does: string; refuses: string }[];
}

/** A matrix cell. `state` is only meaningful before the fix: `differs` is a
 * behaviour the post reports as wrong, `unreported` is a cell the post never
 * reports and which therefore must not be filled in. */
export interface MatrixCell {
	before: string;
	after: string;
	state: "same" | "differs" | "unreported";
}

export interface MatrixFigure {
	kind: "matrix";
	title: string;
	note?: string;
	toggle: string;
	corner: string;
	columns: string[];
	rows: { label: string; cells: MatrixCell[] }[];
}

/** Budget: one reader-driven value feeding two counters. Every step carries its
 * own pair of counts rather than a formula the renderer applies, so a figure can
 * never draw arithmetic the post does not support. */
export interface BudgetFigure {
	kind: "budget";
	title: string;
	note?: string;
	input: string;
	oldLabel: string;
	newLabel: string;
	unit: string;
	steps: { at: string; oldCount: number; newCount: number }[];
}

/** One atom of a rule's condition: a choice group set to an option, or a flag
 * turned on. A `when` fires when any of its atoms hold. */
export type RuleAtom = { type: "choice"; group: number; option: number } | { type: "flag"; index: number };

export interface RuleFigure {
	kind: "rule";
	title: string;
	note?: string;
	choices: { label: string; options: string[] }[];
	flags: string[];
	whens: { atoms: RuleAtom[]; tone: "ok" | "no"; verdict: string; because: string }[];
	fallback: { tone: "ok" | "no"; verdict: string; because: string };
}

export type Figure = BarsFigure | WalkFigure | MatrixFigure | BudgetFigure | RuleFigure;

const ATOM = /^(?:c(\d+)=(\d+)|f(\d+))$/;

function parseAtom(text: string, choices: number, flags: number): RuleAtom {
	const match = ATOM.exec(text.trim());
	assert(match, `rp-figure: "${text}" is not a valid atom (expected cN=M or fN)`);
	if (match[3] !== undefined) {
		const index = Number(match[3]);
		assert(index >= 1 && index <= flags, `rp-figure: atom "${text}" names a flag that does not exist`);
		return { type: "flag", index };
	}
	const group = Number(match[1]);
	const option = Number(match[2]);
	assert(group >= 1 && group <= choices, `rp-figure: atom "${text}" names a choice group that does not exist`);
	return { type: "choice", group, option };
}

function parseTone(text: string): "ok" | "no" {
	assert(text === "ok" || text === "no", `rp-figure: verdict tone must be "ok" or "no", got "${text}"`);
	return text;
}

function parseBars(lines: Line[], title: string, note?: string): BarsFigure {
	const rows = many(lines, "row").map((row) => {
		const [label, beforeValue, beforeText, afterValue, afterText] = fields(row, 5, "a bars row");
		const before = Num.parse(beforeValue);
		const after = Num.parse(afterValue);
		assert(before >= 0 && after >= 0, `rp-figure: bars row "${label}" has a negative value`);
		assert(before > 0 || after > 0, `rp-figure: bars row "${label}" has nothing to draw`);
		return { label, before: { value: before, text: beforeText }, after: { value: after, text: afterText } };
	});
	assert(rows.length > 0, "rp-figure: a bars figure needs at least one row");
	return { kind: "bars", title, note, beforeLabel: one(lines, "before"), afterLabel: one(lines, "after"), rows };
}

function parseWalk(lines: Line[], title: string, note?: string): WalkFigure {
	const steps = many(lines, "step").map((step) => {
		const [name, does, refuses] = fields(step, 3, "a walk step");
		return { name, does, refuses };
	});
	assert(steps.length >= 2 && steps.length <= MAX_STEPS, `rp-figure: a walk needs 2 to ${MAX_STEPS} steps`);
	return { kind: "walk", title, note, toggle: one(lines, "toggle"), steps };
}

function parseCell(text: string): MatrixCell {
	const [rawBefore, rawAfter] = text.split(CELL_SEPARATOR).map((half) => half.trim());
	assert(rawAfter !== undefined, `rp-figure: a matrix cell needs "before ${CELL_SEPARATOR} after" — ${text}`);
	const marker = rawBefore.charAt(0);
	if (marker === "!") return { before: rawBefore.slice(1).trim(), after: rawAfter, state: "differs" };
	if (marker === "?") return { before: rawBefore.slice(1).trim(), after: rawAfter, state: "unreported" };
	return { before: rawBefore, after: rawAfter, state: "same" };
}

function parseMatrix(lines: Line[], title: string, note?: string): MatrixFigure {
	const head = one(lines, "head").split(FIELD_SEPARATOR).map((part) => part.trim());
	const [corner, ...columns] = head;
	assert(columns.length >= 2, "rp-figure: a matrix needs at least two columns");
	const rows = many(lines, "row").map((row) => {
		const [label, ...cells] = fields(row, columns.length + 1, "a matrix row");
		return { label, cells: cells.map(parseCell) };
	});
	assert(rows.length > 0, "rp-figure: a matrix needs at least one row");
	return { kind: "matrix", title, note, toggle: one(lines, "toggle"), corner, columns, rows };
}

function parseBudget(lines: Line[], title: string, note?: string): BudgetFigure {
	const steps = many(lines, "step").map((step) => {
		const [at, oldCount, newCount] = fields(step, 3, "a budget step");
		return { at, oldCount: Num.parse(oldCount), newCount: Num.parse(newCount) };
	});
	assert(steps.length >= 2 && steps.length <= MAX_STEPS, `rp-figure: a budget needs 2 to ${MAX_STEPS} steps`);
	return {
		kind: "budget",
		title,
		note,
		input: one(lines, "input"),
		oldLabel: one(lines, "oldLabel"),
		newLabel: one(lines, "newLabel"),
		unit: one(lines, "unit"),
		steps,
	};
}

function parseRule(lines: Line[], title: string, note?: string): RuleFigure {
	const choices = many(lines, "choice").map((choice) => {
		const parts = choice.split(FIELD_SEPARATOR).map((part) => part.trim());
		const [label, ...options] = parts;
		assert(options.length >= 2, `rp-figure: choice "${label}" needs at least two options`);
		return { label, options };
	});
	const flags = many(lines, "flag");
	const whens = many(lines, "when").map((when) => {
		const arrow = when.indexOf("->");
		assert(arrow > 0, `rp-figure: a when line needs "->" — ${when}`);
		const atoms = when
			.slice(0, arrow)
			.split(",")
			.map((atom) => parseAtom(atom, choices.length, flags.length));
		assert(atoms.length > 0, `rp-figure: a when line needs at least one atom — ${when}`);
		const [tone, verdict, because] = fields(when.slice(arrow + 2).trim(), 3, "a when outcome");
		return { atoms, tone: parseTone(tone), verdict, because };
	});
	const [tone, verdict, because] = fields(one(lines, "else"), 3, "the else outcome");
	assert(choices.length + flags.length > 0, "rp-figure: a rule figure needs at least one choice or flag");
	/** Capped because precedence is expressed as a fixed set of `:has()` rules in
	 * the stylesheet rather than per-figure CSS, and those rules enumerate the
	 * pairs. A fifth branch would silently never hide the ones below it. */
	assert(whens.length >= 1 && whens.length <= MAX_WHENS, `rp-figure: a rule needs 1 to ${MAX_WHENS} when lines`);
	/** An atom decides exactly one branch. Sharing one across two `when` lines
	 * would need a multi-valued `data-fires`, which the stylesheet cannot match. */
	const claimed = new Set<string>();
	for (const when of whens) {
		for (const atom of when.atoms) {
			const key = atom.type === "flag" ? `f${atom.index}` : `c${atom.group}=${atom.option}`;
			assert(!claimed.has(key), `rp-figure: atom "${key}" decides more than one when line`);
			claimed.add(key);
		}
	}
	return { kind: "rule", title, note, choices, flags, whens, fallback: { tone: parseTone(tone), verdict, because } };
}

const KIND = z.enum(["bars", "walk", "matrix", "budget", "rule"]);

/** Turns a fence body into a figure, or throws with the offending line. Called
 * at module init through the posts loader, so a malformed figure fails the
 * "every post loads" test rather than a Lambda cold start. */
export function parseFigure(body: string): Figure {
	const lines = readLines(body);
	const kind = KIND.parse(one(lines, "kind"));
	const title = one(lines, "title");
	const note = optional(lines, "note");
	if (kind === "bars") return parseBars(lines, title, note);
	if (kind === "walk") return parseWalk(lines, title, note);
	if (kind === "matrix") return parseMatrix(lines, title, note);
	if (kind === "budget") return parseBudget(lines, title, note);
	return parseRule(lines, title, note);
}
