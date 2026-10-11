import { withInternalTracking } from "@packages/web-shell";
import {
	READLIST_LABEL_MAX_LENGTH,
	READLIST_MAX_PER_USER,
	type ReadlistSlug,
	type ReadlistRef,
	readerReadlists,
	readlistsHoldingArticle,
} from "@packages/domain/readlist";
import type { ReadlistDefinitionData } from "@packages/provider-contracts/article-store";
import type { ReaderReadlistTags } from "../../shared/article-body/article-header/article-header.component";
import type { ReaderReadlistPicker } from "../../shared/article-body/reader-actions/reader-actions.component";
import { READLIST_KIND_ICON } from "../../shared/readlist-kind-icon";
import { READLIST_NAME_LABEL, READLIST_NAME_PLACEHOLDER } from "./readlist-name-form.component";
import type { FilingToast } from "./readlist-mutation-fragments";
import { READLIST_PATH } from "./readlist.url";

const FILING_SOURCE = "reader-readlists";

export const READER_READLIST_CREATE_POPOVER_ID = "reader-readlist-create";

export interface ReaderReadlistFiling {
	tags: ReaderReadlistTags | undefined;
	picker: ReaderReadlistPicker | undefined;
	markStatusConfirmReadlists: readonly ReadlistRef[] | undefined;
	toast: FilingToast | undefined;
}

export function buildReaderReadlistFiling(input: {
	articleId: string;
	definitions: readonly ReadlistDefinitionData[];
	saves: readonly { readlist?: ReadlistSlug }[];
	returnTo: string;
	filed: ReadlistSlug | undefined;
	markStatusConfirmGated: boolean;
}): ReaderReadlistFiling {
	const memberSlugs = new Set(
		input.saves.flatMap((save) => (save.readlist === undefined ? [] : [save.readlist])),
	);
	const holdsDefaultCopy = input.saves.some((save) => save.readlist === undefined);
	const assigned = input.definitions.filter((definition) => memberSlugs.has(definition.slug));
	const assignable = holdsDefaultCopy
		? input.definitions.filter((definition) => !memberSlugs.has(definition.slug))
		: [];
	const buildPicker = (): ReaderReadlistPicker | undefined => {
		if (!holdsDefaultCopy) return undefined;
		const create =
			input.definitions.length >= READLIST_MAX_PER_USER
				? undefined
				: {
						createUrl: withInternalTracking(
							`${READLIST_PATH}/${input.articleId}/create-and-assign`,
							{ source: FILING_SOURCE, content: "create-and-assign" },
						),
						maxLength: READLIST_LABEL_MAX_LENGTH,
						popoverId: READER_READLIST_CREATE_POPOVER_ID,
						nameLabel: READLIST_NAME_LABEL,
						namePlaceholder: READLIST_NAME_PLACEHOLDER,
					};
		return {
			assignUrl: withInternalTracking(`${READLIST_PATH}/${input.articleId}/assign`, {
				source: FILING_SOURCE,
				content: "assign",
			}),
			returnTo: input.returnTo,
			options: assignable.map(({ slug, label }) => ({ slug, label, iconName: READLIST_KIND_ICON.custom })),
			create,
		};
	};
	const filed = assigned.find((definition) => definition.slug === input.filed);
	return {
		markStatusConfirmReadlists: input.markStatusConfirmGated
			? readlistsHoldingArticle({
					saves: input.saves,
					readlists: readerReadlists(input.definitions),
				})
			: undefined,
		tags:
			assigned.length === 0
				? undefined
				: {
						unassignUrl: withInternalTracking(
							`${READLIST_PATH}/${input.articleId}/unassign`,
							{ source: FILING_SOURCE, content: "unassign" },
						),
						returnTo: input.returnTo,
						tags: assigned.map(({ slug, label }) => ({ slug, label })),
					},
		picker: buildPicker(),
		toast:
			filed === undefined
				? undefined
				: {
						message: `Added to ${filed.label}`,
						undoUrl: `${READLIST_PATH}/${input.articleId}/unassign`,
						undoFields: { queue: filed.slug, returnTo: input.returnTo },
					},
	};
}
