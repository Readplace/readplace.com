import { z } from "zod";
import { DEFAULT_READLIST_SLUG, type ReadlistRef, type ReadlistSlug } from "@packages/domain/readlist";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";

const { t } = translator(hutchReadlist, DEFAULT_LOCALE);

// Outside the filing slug grammar so a legacy custom slug can always be addressed.
export const HandPickedScopeSchema = z.literal("~hand-picked").brand<"ReadlistSlug">();
export const HAND_PICKED_SCOPE = HandPickedScopeSchema.parse("~hand-picked");
export const HAND_PICKED = { slug: HAND_PICKED_SCOPE, label: t("handPicked.label") };
export const READER_HOME_HREF = "/queue?scope=hand-picked";

export const isBuiltInReadlist = (slug: ReadlistSlug) => slug === DEFAULT_READLIST_SLUG || slug === HAND_PICKED_SCOPE;

export const builtInCaption = (slug: ReadlistSlug) =>
	slug === HAND_PICKED_SCOPE ? t("handPicked.caption") : slug === DEFAULT_READLIST_SLUG ? t("handPicked.allCaption") : undefined;

export const withHandPicked = (readlists: readonly ReadlistRef[]): readonly ReadlistRef[] => [...readlists, HAND_PICKED];
