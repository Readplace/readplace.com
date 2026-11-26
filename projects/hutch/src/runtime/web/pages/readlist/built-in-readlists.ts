import {
	DEFAULT_READLIST,
	DEFAULT_READLIST_SLUG,
	HAND_PICKED_SCOPE,
	presentReaderReadlistLabels,
	readerReadlists,
	type ReadlistRef,
	type ReadlistSlug,
} from "@packages/domain/readlist";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";

const { t } = translator(hutchReadlist, DEFAULT_LOCALE);

export { HandPickedScopeSchema, HAND_PICKED_SCOPE } from "@packages/domain/readlist";
export const HAND_PICKED = { slug: HAND_PICKED_SCOPE, label: t("handPicked.label") };
export const HAND_PICKED_HREF = "/queue?scope=hand-picked";
export const READER_HOME_HREF = "/queue?scope=home";

export const BUILT_IN_READLIST_SLUGS: readonly ReadlistSlug[] = [HAND_PICKED_SCOPE, DEFAULT_READLIST_SLUG];

export const isBuiltInReadlist = (slug: ReadlistSlug) => BUILT_IN_READLIST_SLUGS.includes(slug);

export const builtInCaption = (slug: ReadlistSlug) =>
	slug === HAND_PICKED_SCOPE ? t("handPicked.caption") : slug === DEFAULT_READLIST_SLUG ? t("handPicked.allCaption") : undefined;

export const withHandPicked = (readlists: readonly ReadlistRef[]): readonly ReadlistRef[] => [...readlists, HAND_PICKED];

export const withHandPickedHolding = <Save extends { readlist?: ReadlistSlug }>(
	saves: readonly Save[],
	picked: boolean,
): readonly { readlist?: ReadlistSlug }[] => (picked ? [...saves, { readlist: HAND_PICKED_SCOPE }] : saves);

export const DEFAULT_READLIST_NAMES = { name: t("defaultReadlist.name"), qualifiedName: t("defaultReadlist.qualifiedName") };

export const DEFAULT_READLIST_SHOWN: ReadlistRef = { ...DEFAULT_READLIST, label: DEFAULT_READLIST_NAMES.name };

export const presentReadlistLabels = <T extends ReadlistRef>(readlists: readonly T[]): T[] =>
	presentReaderReadlistLabels({ readlists, names: DEFAULT_READLIST_NAMES });

export const shownReaderReadlists = (definitions: Parameters<typeof readerReadlists>[0]): ReadlistRef[] =>
	presentReadlistLabels(readerReadlists(definitions));

export const defaultReadlistOf = (readlists: readonly ReadlistRef[]): ReadlistRef =>
	readlists.find((readlist) => readlist.slug === DEFAULT_READLIST_SLUG) ?? DEFAULT_READLIST_SHOWN;

export const defaultReadlistLabelOf = (readlists: readonly ReadlistRef[]): string => defaultReadlistOf(readlists).label;
