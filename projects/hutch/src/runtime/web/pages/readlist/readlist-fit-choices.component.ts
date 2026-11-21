import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ReadlistSlug, readlistFitChoiceLabel } from "@packages/domain/readlist";
import type { ReadlistFitOverride } from "@packages/provider-contracts/article-store";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";
import { type LocalTime, render, renderConfirmPopover, toAbsoluteDate, withInternalTracking } from "@packages/web-shell";
import { readlistFitOverrideDeletePath } from "./readlist.url";


const TEMPLATE = readFileSync(join(__dirname, "readlist-fit-choices.template.html"), "utf-8");

const CHOICES_SOURCE = "queue-preferences";

const INFO_POPOVER_ID = "readlist-choices-info";

const { t } = translator(hutchReadlist, DEFAULT_LOCALE);

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
	const infoPopoverHtml = renderConfirmPopover({
		id: INFO_POPOVER_ID,
		key: INFO_POPOVER_ID,
		title: t("readlistChoices.info.title"),
		body: t("readlistChoices.info.body"),
		close: {},
		actionsHtml: "",
	});
	return render(TEMPLATE, {
		rows,
		infoPopoverId: INFO_POPOVER_ID,
		infoButtonLabel: t("readlistChoices.info.button"),
		infoPopoverHtml,
	});
}
