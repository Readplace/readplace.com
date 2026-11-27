import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "@packages/domain/readlist";
import type { ReadlistDefinitionData } from "@packages/provider-contracts/article-store";
import type { HomeReadlistPreference } from "@packages/provider-contracts/auth";
import { READLIST_CREATE_PATH } from "./readlist.url";
import { BUILT_IN_READLIST_SLUGS, HAND_PICKED_SCOPE, isBuiltInReadlist } from "./built-in-readlists";

export const HOME_READLIST_SAVED = "home_saved";

export function homeReadlistOf(
	preference: HomeReadlistPreference | undefined,
	definitions: readonly ReadlistDefinitionData[],
): ReadlistSlug {
	if (preference && isBuiltInReadlist(preference.slug)) return preference.slug;
	if (preference && definitions.some((definition) =>
		definition.slug === preference.slug && definition.createdAt.toISOString() === preference.createdAt,
	)) return preference.slug;
	return HAND_PICKED_SCOPE;
}

export function homeEntryReadlistOf(
	preference: HomeReadlistPreference | undefined,
	definitions: readonly ReadlistDefinitionData[],
): ReadlistSlug {
	const home = homeReadlistOf(preference, definitions);
	return home === preference?.slug ? home : DEFAULT_READLIST_SLUG;
}

export function homeReadlistTarget(
	slug: ReadlistSlug,
	definitions: readonly ReadlistDefinitionData[],
): HomeReadlistPreference | undefined {
	if (isBuiltInReadlist(slug)) return { slug };
	const definition = definitions.find((item) => item.slug === slug);
	return definition && { slug, createdAt: definition.createdAt.toISOString() };
}

export function homeReadlistTargets(
	home: ReadlistSlug,
	definitions: readonly ReadlistDefinitionData[],
): ReadonlyMap<ReadlistSlug, HomeReadlistPreference> {
	const slugs = [...BUILT_IN_READLIST_SLUGS, ...definitions.map((definition) => definition.slug)];
	return new Map(slugs.flatMap((slug) => {
		const target = homeReadlistTarget(slug, definitions);
		return target && slug !== home ? [[slug, target] as const] : [];
	}));
}

export function setHomeReadlistPath(preference: HomeReadlistPreference): string {
	const path = `${READLIST_CREATE_PATH}/${preference.slug}/home`;
	return preference.createdAt === undefined ? path : `${path}?createdAt=${encodeURIComponent(preference.createdAt)}`;
}
