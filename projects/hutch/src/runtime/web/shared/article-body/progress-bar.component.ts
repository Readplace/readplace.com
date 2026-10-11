import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";

const VISIBLE_TEMPLATE = readFileSync(join(__dirname, "progress-bar.template.html"), "utf-8");
const HIDDEN_TEMPLATE = readFileSync(join(__dirname, "progress-bar-hidden.template.html"), "utf-8");

export function renderProgressBar(input: {
	axis: "reader" | "summary";
	pct: number;
	labelledBy: string;
}): string {
	const pctWhole = Math.floor(input.pct);
	return render(VISIBLE_TEMPLATE, {
		axis: input.axis,
		pct: input.pct,
		pctWhole,
		label: `${pctWhole}% complete`,
		labelledBy: input.labelledBy,
	});
}

export function renderHiddenProgressBar(input: { axis: "reader" | "summary" }): string {
	return render(HIDDEN_TEMPLATE, { axis: input.axis });
}
