import type {
	BarsFigure,
	BudgetFigure,
	Figure,
	MatrixFigure,
	RuleAtom,
	RuleFigure,
	WalkFigure,
} from "./blog-figure.parse";

const ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
};

/** Figure text is author copy from a post, not markup. It is escaped rather than
 * passed through so a stray `<` in a value (a `<Location>` header, a `<script>`
 * mentioned in prose) renders as text instead of opening a tag. */
function esc(text: string): string {
	return text.replace(/[&<>"]/g, (char) => ESCAPES[char]);
}

/** Percentage of the row's own larger value. Rows carry different units, so each
 * is scaled to itself and both numbers are always printed beside the bars — the
 * length is a comparison within the row and never the only carrier of a value. */
function share(value: number, max: number): string {
	return `${((value / max) * 100).toFixed(1)}%`;
}

function renderBars(figure: BarsFigure, id: string): string {
	const rows = figure.rows
		.map((row) => {
			const max = Math.max(row.before.value, row.after.value);
			return `<div class="rpf-bars__row">
<div class="rpf-bars__label">${esc(row.label)}</div>
<div class="rpf-bars__pair">
<div class="rpf-bars__line"><span class="rpf-bars__track"><span class="rpf-bars__fill rpf-bars__fill--before" style="width:${share(row.before.value, max)}"></span></span><span class="rpf-bars__value">${esc(row.before.text)}</span></div>
<div class="rpf-bars__line"><span class="rpf-bars__track"><span class="rpf-bars__fill rpf-bars__fill--after" style="width:${share(row.after.value, max)}"></span></span><span class="rpf-bars__value">${esc(row.after.text)}</span></div>
</div>
</div>`;
		})
		.join("\n");

	return `<figure class="rpf rpf-bars" id="${id}">
${heading(figure)}
<div class="rpf__legend"><span><i class="rpf__swatch rpf__swatch--before"></i>${esc(figure.beforeLabel)}</span><span><i class="rpf__swatch rpf__swatch--after"></i>${esc(figure.afterLabel)}</span></div>
<div class="rpf-bars__rows">
${rows}
</div>
</figure>`;
}

function renderWalk(figure: WalkFigure, id: string): string {
	const radios = figure.steps
		.map(
			(step, index) =>
				`<input type="radio" name="${id}-step" id="${id}-s${index}" class="rpf-walk__pick"${index === 0 ? " checked" : ""}>`,
		)
		.join("\n");

	const steps = figure.steps
		.map(
			(step, index) => `<label class="rpf-walk__step" for="${id}-s${index}">
<span class="rpf-walk__gutter"><span class="rpf-walk__dot"></span><span class="rpf-walk__stem"></span></span>
<span class="rpf-walk__body"><span class="rpf-walk__name">${esc(step.name)}</span>
<span class="rpf-walk__note rpf-walk__note--does">${esc(step.does)}</span>
<span class="rpf-walk__note rpf-walk__note--refuses">${esc(step.refuses)}</span>
</span>
</label>`,
		)
		.join("\n");

	return `<figure class="rpf rpf-walk" id="${id}">
${heading(figure)}
${radios}
${switchControl(`${id}-reject`, "rpf-walk__reject", figure.toggle)}
<div class="rpf-walk__chain">
${steps}
</div>
</figure>`;
}

const NOT_REPORTED = "not reported";

function renderMatrix(figure: MatrixFigure, id: string): string {
	const head = figure.columns.map((column) => `<th scope="col">${esc(column)}</th>`).join("");
	const rows = figure.rows
		.map((row) => {
			const cells = row.cells
				.map((cell) => {
					const before =
						cell.state === "unreported"
							? `<span class="rpf-matrix__cell rpf-matrix__cell--before rpf-matrix__cell--unreported">${NOT_REPORTED}</span>`
							: `<span class="rpf-matrix__cell rpf-matrix__cell--before${cell.state === "differs" ? " rpf-matrix__cell--differs" : ""}">${esc(cell.before)}</span>`;
					/** The tint means "the fix moved this cell". A cell the post never
					 * reported cannot be shown to have moved, so it stays plain — the
					 * same restraint that keeps its before half from being filled in. */
					const moved = cell.state === "differs" || cell.before !== cell.after;
					const changed = cell.state !== "unreported" && moved ? " rpf-matrix__cell--now" : "";
					return `<td>${before}<span class="rpf-matrix__cell rpf-matrix__cell--after${changed}">${esc(cell.after)}</span></td>`;
				})
				.join("");
			return `<tr><th scope="row">${esc(row.label)}</th>${cells}</tr>`;
		})
		.join("\n");

	return `<figure class="rpf rpf-matrix" id="${id}">
${heading(figure)}
${switchControl(`${id}-after`, "rpf-matrix__flip", figure.toggle)}
<div class="rpf-matrix__scroll">
<table class="rpf-matrix__table">
<thead><tr><th scope="col">${esc(figure.corner)}</th>${head}</tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>
</figure>`;
}

function renderBudget(figure: BudgetFigure, id: string): string {
	const last = figure.steps.length - 1;
	const radios = figure.steps
		.map(
			(step, index) =>
				`<input type="radio" name="${id}-at" id="${id}-a${index}" class="rpf-budget__pick"${index === last ? " checked" : ""}>`,
		)
		.join("\n");

	const ticks = figure.steps
		.map(
			(step, index) =>
				`<label class="rpf-budget__tick" for="${id}-a${index}"><span class="rpf-budget__stop"></span><span class="rpf-budget__at">${esc(step.at)}</span></label>`,
		)
		.join("\n");

	const peak = Math.max(...figure.steps.flatMap((step) => [step.oldCount, step.newCount]));
	const states = figure.steps
		.map((step, index) => {
			const bar = (count: number, variant: string) =>
				`<span class="rpf-budget__column"><span class="rpf-budget__count">${count}</span><span class="rpf-budget__bar rpf-budget__bar--${variant}" style="height:${share(count, peak)}"></span></span>`;
			return `<div class="rpf-budget__state${index === last ? " rpf-budget__state--fallback" : ""}">
<div class="rpf-budget__plot">${bar(step.oldCount, "old")}${bar(step.newCount, "new")}</div>
</div>`;
		})
		.join("\n");

	return `<figure class="rpf rpf-budget" id="${id}">
${heading(figure)}
${radios}
<div class="rpf-budget__control">
<span class="rpf-budget__input">${esc(figure.input)}</span>
<div class="rpf-budget__track">
${ticks}
</div>
</div>
<div class="rpf-budget__states">
${states}
</div>
<div class="rpf-budget__axis"><span>${esc(figure.oldLabel)}</span><span>${esc(figure.newLabel)}</span></div>
<p class="rpf-budget__unit">${esc(figure.unit)}</p>
</figure>`;
}

function atomInput(atom: RuleAtom, id: string): string {
	return atom.type === "flag" ? `${id}-f${atom.index - 1}` : `${id}-c${atom.group - 1}o${atom.option - 1}`;
}

function renderRule(figure: RuleFigure, id: string): string {
	/** Which branch each input decides, read straight off the `when` lines. The
	 * stylesheet matches on this attribute rather than on generated ids, which is
	 * what keeps the precedence rules in one shared stylesheet. */
	const fires = new Map<string, number>();
	figure.whens.forEach((when, index) => {
		for (const atom of when.atoms) fires.set(atomInput(atom, id), index + 1);
	});
	const firesAttr = (input: string) => {
		const branch = fires.get(input);
		return branch === undefined ? "" : ` data-fires="${branch}"`;
	};

	const choices = figure.choices
		.map((choice, group) => {
			const options = choice.options
				.map((option, index) => {
					const input = `${id}-c${group}o${index}`;
					return `<input type="radio" name="${id}-c${group}" id="${input}" class="rpf-rule__input"${firesAttr(input)}${index === 0 ? " checked" : ""}><label class="rpf-rule__option" for="${input}">${esc(option)}</label>`;
				})
				.join("");
			return `<div class="rpf-rule__group" role="group" aria-label="${esc(choice.label)}"><span class="rpf-rule__legend">${esc(choice.label)}</span><span class="rpf-rule__options">${options}</span></div>`;
		})
		.join("\n");

	const flags = figure.flags
		.map((flag, index) => {
			const input = `${id}-f${index}`;
			return `<input type="checkbox" id="${input}" class="rpf-rule__input"${firesAttr(input)}><label class="rpf-rule__option rpf-rule__option--flag" for="${input}">${esc(flag)}</label>`;
		})
		.join("");

	const outcome = (
		out: { tone: "ok" | "no"; verdict: string; because: string },
		attr: string,
		fallback: boolean,
	) =>
		`<p class="rpf-rule__outcome rpf-rule__outcome--${out.tone}${fallback ? " rpf-rule__outcome--fallback" : ""}"${attr}><strong class="rpf-rule__verdict">${esc(out.verdict)}</strong><span class="rpf-rule__because">${esc(out.because)}</span></p>`;

	const outcomes = figure.whens
		.map((when, index) => outcome(when, ` data-out="${index + 1}"`, false))
		.join("\n");

	return `<figure class="rpf rpf-rule" id="${id}">
${heading(figure)}
<div class="rpf-rule__controls">
${choices}
${flags === "" ? "" : `<div class="rpf-rule__group rpf-rule__group--flags">${flags}</div>`}
</div>
<div class="rpf-rule__readout">
${outcomes}
${outcome(figure.fallback, ' data-out="else"', true)}
</div>
</figure>`;
}

function heading(figure: Figure): string {
	const note = figure.note === undefined ? "" : `\n<p class="rpf__note">${esc(figure.note)}</p>`;
	return `<p class="rpf__title">${esc(figure.title)}</p>${note}`;
}

/** The one switch shape the interactive figures share: a checkbox whose label
 * carries the track. Native, so keyboard and assistive tech come for free. */
function switchControl(inputId: string, inputClass: string, label: string): string {
	return `<span class="rpf__switch"><input type="checkbox" id="${inputId}" class="${inputClass}"><label for="${inputId}"><span class="rpf__switch-track"></span>${esc(label)}</label></span>`;
}

/** Draws a parsed figure. `index` makes the input ids unique so a post can carry
 * more than one figure without their radio groups colliding. */
export function renderFigure(figure: Figure, index: number): string {
	const id = `rpf-${index}`;
	if (figure.kind === "bars") return renderBars(figure, id);
	if (figure.kind === "walk") return renderWalk(figure, id);
	if (figure.kind === "matrix") return renderMatrix(figure, id);
	if (figure.kind === "budget") return renderBudget(figure, id);
	return renderRule(figure, id);
}
