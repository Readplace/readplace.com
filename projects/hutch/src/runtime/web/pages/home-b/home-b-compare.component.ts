import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";
import {
	type HomeCompareTone,
	HOME_COMPARE_CONTENT,
	HOME_COMPARE_FEATURES,
	HOME_COMPARE_PRICES,
} from "./home-b-compare.content";

const TEMPLATE = readFileSync(join(__dirname, "home-b-compare.template.html"), "utf-8");

interface CompareColumn {
	readonly label: string;
	readonly tone: HomeCompareTone;
	readonly headClass: string;
	readonly cellClass: string;
}

const { columns } = HOME_COMPARE_CONTENT;

const READPLACE_COLUMN = {
	tone: "readplace",
	headClass: "home-compare__head--readplace",
	cellClass: "home-compare__cell home-compare__cell--readplace",
} as const;

const AI_COLUMN = {
	tone: "ai",
	headClass: "home-compare__head",
	cellClass: "home-compare__cell home-compare__cell--ai",
} as const;

const COLUMN_HEADS: readonly CompareColumn[] = [
	{ label: columns.readplace, ...READPLACE_COLUMN },
	{ label: columns.claude, ...AI_COLUMN },
	{ label: columns.chatgpt, ...AI_COLUMN },
];

const FEATURE_ANSWER: Record<HomeCompareTone, { readonly text: string; readonly glyph: "check" | "x" }> = {
	readplace: { text: "Yes", glyph: "check" },
	ai: { text: "No", glyph: "x" },
};

export function renderHomeCompareSection(): string {
	return render(TEMPLATE, {
		...HOME_COMPARE_CONTENT,
		columnHeads: COLUMN_HEADS,
		rows: [
			...HOME_COMPARE_PRICES.map((price) => ({
				key: price.key,
				label: price.label,
				cells: COLUMN_HEADS.map((column) => ({
					...column,
					text: price[column.tone],
					textClass: "home-compare__value",
				})),
			})),
			...HOME_COMPARE_FEATURES.map((feature) => ({
				key: feature.key,
				label: feature.label,
				cells: COLUMN_HEADS.map((column) => ({
					...column,
					...FEATURE_ANSWER[column.tone],
					textClass: "sr-only",
				})),
			})),
		],
		ctaHref: withInternalTracking("/signup", { source: "home-compare", content: "compare-signup" }),
	});
}
