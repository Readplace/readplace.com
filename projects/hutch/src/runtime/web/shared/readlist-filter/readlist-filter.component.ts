import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";
import { render } from "@packages/web-shell";

export const READLIST_FILTER_SHOWN_ABOVE = 10;

const { t } = translator(hutchReadlist, DEFAULT_LOCALE);

const READLIST_FILTER_TEMPLATE = `<{{tag}} class="readlist-filter{{#if extraClass}} {{extraClass}}{{/if}}" hidden data-readlist-filter data-test-readlist-filter>
	<input class="form-input readlist-filter__input" type="search" placeholder="{{label}}" aria-label="{{label}}" autocomplete="off" enterkeyhint="search" data-readlist-filter-input data-test-readlist-filter-input>
	<p class="readlist-filter__status" role="status" aria-live="polite" data-readlist-filter-status data-empty-message="{{noMatch}}" data-test-readlist-filter-status></p>
</{{tag}}>`;

export function renderReadlistFilter(input: {
	readlistCount: number;
	tag: "div" | "li";
	extraClass?: string;
}): string {
	if (input.readlistCount <= READLIST_FILTER_SHOWN_ABOVE) return "";
	return render(READLIST_FILTER_TEMPLATE, {
		tag: input.tag,
		extraClass: input.extraClass,
		label: t("readlistPicker.filter.label"),
		noMatch: t("readlistPicker.filter.noMatch"),
	});
}
