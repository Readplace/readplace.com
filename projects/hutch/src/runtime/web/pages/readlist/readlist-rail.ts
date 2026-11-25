import { HAND_PICKED, HAND_PICKED_SCOPE, personalHomeEnabled } from "./built-in-readlists";
import { DEFAULT_READLIST_SLUG, READLIST_MAX_PER_USER, type ReadlistSlug } from "@packages/domain/readlist";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";
import type { UpgradeOffer } from "../../shared/upgrade-offer/upgrade-offer";
import type { ReadlistContext } from "./readlist-context";
import type { Readlist } from "./readlist.nav";
import { READLIST_ERROR_LIMIT } from "./readlist.error";
import { HOME_READLIST_SAVED } from "./readlist-home";
import { READLIST_PATH, READLIST_CREATE_PATH, buildReadlistUrl, readlistReturnQuery } from "./readlist.url";

const { t } = translator(hutchReadlist, DEFAULT_LOCALE);

export interface ReadlistRailViewModel {
	readlists: readonly Readlist[];
	activeReadlist: Readlist;
	newReadlistAction: string;
	limitAlertHref: string;
	canCreate: boolean;
	offer: UpgradeOffer | undefined;
	nonEmptyReadlists: readonly ReadlistSlug[];
	pinnedReadlists: readonly ReadlistSlug[];
	home?: ReadlistContext["home"] & { returnTo: string; status?: string };
}

export function buildReadlistRail(input: {
	context: ReadlistContext;
	offer: UpgradeOffer | undefined;
	nonEmptyReadlists: readonly ReadlistSlug[];
	originalUrl?: string;
}): ReadlistRailViewModel {
	const custom = input.context.readlists.filter((readlist) => readlist.slug !== DEFAULT_READLIST_SLUG);
	const { home } = input.context;
	const landing = new URL(input.originalUrl ?? buildReadlistUrl(input.context.state), "https://readlist.invalid");
	const saved = landing.searchParams.get(HOME_READLIST_SAVED);
	landing.searchParams.delete(HOME_READLIST_SAVED);
	if (input.context.state.readlist !== HAND_PICKED_SCOPE && (landing.pathname === READLIST_PATH || landing.pathname === `${READLIST_PATH}/`)) {
		landing.pathname = READLIST_PATH;
		landing.searchParams.delete("readlist");
		landing.searchParams.set("queue", input.context.state.readlist);
	}
	const label = saved === home?.slug ? input.context.readlists.find(({ slug }) => slug === saved)?.label : undefined;
	return {
		home: home && { ...home, returnTo: landing.pathname + landing.search, status: label && t("readlistNav.home.saved", { label }) },
		readlists: personalHomeEnabled() ? [HAND_PICKED, ...input.context.readlists] : input.context.readlists,
		activeReadlist: input.context.activeReadlist,
		newReadlistAction: `${READLIST_CREATE_PATH}${readlistReturnQuery(input.context.state)}`,
		limitAlertHref: buildReadlistUrl(input.context.state, [["queue_error", READLIST_ERROR_LIMIT]]),
		canCreate: custom.length < READLIST_MAX_PER_USER,
		offer: input.offer,
		nonEmptyReadlists: input.nonEmptyReadlists,
		pinnedReadlists: input.context.pinnedReadlists,
	};
}
