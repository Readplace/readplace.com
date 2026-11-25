import { getEnv } from "@packages/require-env";
import { z } from "zod";
import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "@packages/domain/readlist";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";

const { t } = translator(hutchReadlist, DEFAULT_LOCALE);

// Outside the filing slug grammar so a legacy custom slug can always be addressed.
export const HAND_PICKED_SCOPE = z.literal("~hand-picked").brand<"ReadlistSlug">().parse("~hand-picked");
export const HAND_PICKED = { slug: HAND_PICKED_SCOPE, label: t("handPicked.label") };

export const isBuiltInReadlist = (slug: ReadlistSlug) => slug === DEFAULT_READLIST_SLUG || slug === HAND_PICKED_SCOPE;

export const builtInCaption = (slug: ReadlistSlug) =>
	slug === HAND_PICKED_SCOPE ? t("handPicked.caption") : slug === DEFAULT_READLIST_SLUG ? t("handPicked.allCaption") : undefined;

// Infrastructure holds the home on All while the new writers and historical reconciliation roll out.
export const personalHomeEnabled = () => getEnv("HAND_PICKED_HOME_ENABLED") === "true";
export const readerHomeHref = () => personalHomeEnabled() ? "/queue?scope=hand-picked" : "/queue";
