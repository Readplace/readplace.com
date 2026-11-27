import { DEFAULT_READLIST_SLUG, HAND_PICKED_SCOPE, type ReadlistRef, type ReadlistSlug } from "@packages/domain/readlist";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";

const { t } = translator(hutchReadlist, DEFAULT_LOCALE);

export { HandPickedScopeSchema, HAND_PICKED_SCOPE } from "@packages/domain/readlist";
export const HAND_PICKED = { slug: HAND_PICKED_SCOPE, label: t("handPicked.label") };
export const READER_HOME_HREF = "/queue?scope=hand-picked";

export const BUILT_IN_READLIST_SLUGS: readonly ReadlistSlug[] = [HAND_PICKED_SCOPE, DEFAULT_READLIST_SLUG];

export const isBuiltInReadlist = (slug: ReadlistSlug) => BUILT_IN_READLIST_SLUGS.includes(slug);

export const builtInCaption = (slug: ReadlistSlug) =>
	slug === HAND_PICKED_SCOPE ? t("handPicked.caption") : slug === DEFAULT_READLIST_SLUG ? t("handPicked.allCaption") : undefined;

export const withHandPicked = (readlists: readonly ReadlistRef[]): readonly ReadlistRef[] => [...readlists, HAND_PICKED];

export const withHandPickedHolding = <Save extends { readlist?: ReadlistSlug }>(
	saves: readonly Save[],
	picked: boolean,
): readonly { readlist?: ReadlistSlug }[] => (picked ? [...saves, { readlist: HAND_PICKED_SCOPE }] : saves);
