import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";

const TEMPLATE = readFileSync(join(__dirname, "readlist-tab-total.template.html"), "utf-8");

const TAB_TOTAL_CAP = 9999;

function formatTabTotal(total: number): string {
	return total > TAB_TOTAL_CAP ? `${TAB_TOTAL_CAP}+` : String(total);
}

interface ReadlistTabTotalDisplayModel {
	number: string;
	noun: string;
	valueClass: string;
	oob: boolean;
}

function toReadlistTabTotalDisplayModel(input: {
	total: number | undefined;
	oob?: boolean;
}): ReadlistTabTotalDisplayModel {
	const total = input.total;
	return {
		number: total === undefined ? "" : formatTabTotal(total),
		noun: `Saved Article${total === 1 ? "" : "s"}`,
		valueClass:
			total === undefined
				? "readlist__count-value readlist__count-value--pending"
				: "readlist__count-value readlist__count-value--known",
		oob: input.oob ?? false,
	};
}

export function renderReadlistTabTotal(input: {
	total: number | undefined;
	oob?: boolean;
}): string {
	return render(TEMPLATE, toReadlistTabTotalDisplayModel(input));
}
