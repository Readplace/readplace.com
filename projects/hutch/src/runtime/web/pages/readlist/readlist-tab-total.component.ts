import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";

import { type TabId, tabCountNoun } from "./readlist.tabs";

const TEMPLATE = readFileSync(join(__dirname, "readlist-tab-total.template.html"), "utf-8");

const TAB_TOTAL_CAP = 9999;

function formatTabTotal(total: number): string {
	return total > TAB_TOTAL_CAP ? `${TAB_TOTAL_CAP}+` : String(total);
}

const WIDEST_NUMBER = formatTabTotal(Number.MAX_SAFE_INTEGER);

interface ReadlistTabTotalDisplayModel {
	number: string;
	noun: string;
	valueClass: string;
	widestNumber: string;
	oob: boolean;
}

function toReadlistTabTotalDisplayModel(input: {
	tab: TabId;
	total: number | undefined;
	oob?: boolean;
}): ReadlistTabTotalDisplayModel {
	const total = input.total;
	return {
		number: total === undefined ? "" : formatTabTotal(total),
		noun: `${tabCountNoun(input.tab)} Article${total === 1 ? "" : "s"}`,
		valueClass:
			total === undefined
				? "readlist__count-value readlist__count-value--pending"
				: "readlist__count-value readlist__count-value--known",
		widestNumber: WIDEST_NUMBER,
		oob: input.oob ?? false,
	};
}

export function renderReadlistTabTotal(input: {
	tab: TabId;
	total: number | undefined;
	oob?: boolean;
}): string {
	return render(TEMPLATE, toReadlistTabTotalDisplayModel(input));
}
