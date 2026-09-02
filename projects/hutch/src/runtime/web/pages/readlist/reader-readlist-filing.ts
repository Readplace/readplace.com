import {
	DEFAULT_READLIST_SLUG,
	READLIST_LABEL_MAX_LENGTH,
	READLIST_MAX_PER_USER,
	type ReadlistSlug,
} from "@packages/domain/readlist";
import type { ReadlistDefinitionData } from "@packages/provider-contracts/article-store";
import type { ReaderReadlistTags } from "../../shared/article-body/article-header/article-header.component";
import type { ReaderReadlistPicker } from "../../shared/article-body/reader-actions/reader-actions.component";
import { readerReadlists } from "./readlist-context";
import { READLIST_PATH } from "./readlist.url";

export interface ReaderReadlistFiling {
	tags: ReaderReadlistTags | undefined;
	picker: ReaderReadlistPicker | undefined;
	markStatusConfirmReadlistLabels: readonly string[] | undefined;
}

export function buildReaderReadlistFiling(input: {
	articleId: string;
	definitions: readonly ReadlistDefinitionData[];
	saves: readonly { readlist?: ReadlistSlug }[];
	returnTo: string;
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
	const heldSlugs = new Set(input.saves.map((save) => save.readlist ?? DEFAULT_READLIST_SLUG));
	const buildPicker = (): ReaderReadlistPicker | undefined => {
		if (!holdsDefaultCopy) return undefined;
		const create =
			input.definitions.length >= READLIST_MAX_PER_USER
				? undefined
				: {
						createUrl: `${READLIST_PATH}/${input.articleId}/create-and-assign`,
						maxLength: READLIST_LABEL_MAX_LENGTH,
					};
		return {
			assignUrl: `${READLIST_PATH}/${input.articleId}/assign`,
			returnTo: input.returnTo,
			options: assignable.map(({ slug, label }) => ({ slug, label })),
			create,
		};
	};
	return {
		markStatusConfirmReadlistLabels: input.markStatusConfirmGated
			? readerReadlists(input.definitions)
					.filter((readlist) => heldSlugs.has(readlist.slug))
					.map((readlist) => readlist.label)
			: undefined,
		tags:
			assigned.length === 0
				? undefined
				: {
						unassignUrl: `${READLIST_PATH}/${input.articleId}/unassign`,
						returnTo: input.returnTo,
						tags: assigned.map(({ slug, label }) => ({ slug, label })),
					},
		picker: buildPicker(),
	};
}
