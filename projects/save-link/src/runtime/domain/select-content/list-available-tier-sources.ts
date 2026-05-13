import type { ReadTierSource } from "../../providers/article-store/read-tier-source";
import type { TierSource } from "./tier-source.types";
import { KNOWN_TIERS } from "./tier.types";

export type ListAvailableTierSources = (url: string) => Promise<TierSource[]>;

export function initListAvailableTierSources(deps: {
	readTierSource: ReadTierSource;
}): { listAvailableTierSources: ListAvailableTierSources } {
	const { readTierSource } = deps;

	const listAvailableTierSources: ListAvailableTierSources = async (url) => {
		const reads = await Promise.all(
			KNOWN_TIERS.map((tier) => readTierSource({ url, tier })),
		);
		return reads.filter((source): source is TierSource => source !== undefined);
	};

	return { listAvailableTierSources };
}
