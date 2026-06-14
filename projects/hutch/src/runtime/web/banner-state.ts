import type { UserId } from "@packages/domain/user";
import { bannerStateFromRequest } from "@packages/web-shell";
import type { BannerState, BannerStateSource } from "@packages/web-shell";
import type {
	EffectiveAccess,
	GetEffectiveAccess,
} from "../domain/access/effective-access";
import { toTrialDisplay } from "./trial-display";

export type BuildBannerState = (
	source: BannerStateSource,
	options?: { preFetchedAccess?: EffectiveAccess },
) => Promise<BannerState>;

export function initBuildBannerState(deps: {
	getEffectiveAccess: GetEffectiveAccess;
	now: () => Date;
}): BuildBannerState {
	return async (source, options) => {
		const base = bannerStateFromRequest(source);
		const userId: UserId | undefined = source.userId;
		if (!userId) return base;
		const access =
			options?.preFetchedAccess ?? (await deps.getEffectiveAccess(userId));
		const trial = toTrialDisplay(access, deps.now());
		const accessIsReadOnly = access.access === "read-only";
		return { ...base, accessIsReadOnly, ...(trial ? { trial } : {}) };
	};
}
