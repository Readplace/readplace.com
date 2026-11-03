import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ReadlistSlug, readlistFitChoiceLabel } from "@packages/domain/readlist";
import type { ReadlistFitOverride } from "@packages/provider-contracts/article-store";
import { type LocalTime, render, toAbsoluteDate, withInternalTracking } from "@packages/web-shell";
import { readlistFitOverrideDeletePath } from "./readlist.url";


const TEMPLATE = readFileSync(join(__dirname, "readlist-fit-choices.template.html"), "utf-8");

const CHOICES_SOURCE = "queue-preferences";

export type ReadlistFitChoices = readonly ReadlistFitOverride[];

interface ReadlistFitChoiceRow {
	id: string;
	parts: readonly string[];
	createdAt: LocalTime;
	action: string;
	removeLabel: string;
}

export function renderReadlistFitChoices(input: {
	readlist: { slug: ReadlistSlug; label: string; purpose?: string };
	choices: ReadlistFitChoices;
}): string {
	if (input.readlist.purpose === undefined || input.choices.length === 0) return "";
	const rows = input.choices.map((choice): ReadlistFitChoiceRow => {
		const label = readlistFitChoiceLabel({ readerVerdict: choice.readerVerdict, label: input.readlist.label });
		const anchorParts = choice.anchorText === "" ? [] : [choice.anchorText];
		return {
			id: choice.id,
			parts: [label, ...anchorParts, choice.host],
			createdAt: toAbsoluteDate({ iso: choice.createdAt.toISOString() }),
			action: withInternalTracking(
				readlistFitOverrideDeletePath(input.readlist.slug, choice.id),
				{ source: CHOICES_SOURCE, content: "remove-choice" },
			),
			removeLabel: `Remove ${label}: ${choice.anchorText === "" ? choice.host : choice.anchorText}`,
		};
	});
	return render(TEMPLATE, { rows });
}
