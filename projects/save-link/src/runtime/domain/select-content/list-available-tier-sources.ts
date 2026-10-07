import type { CandidateId } from "@packages/domain/article";
import type { ReadTierSource } from "../../providers/article-store/read-tier-source";
import type { TierSource } from "./tier-source.types";
import { KNOWN_TIERS } from "./tier.types";
import type { Tier } from "./tier.types";

export type CandidateReference = { id: CandidateId; tier: Tier };
export type ListAvailableTierSources = (url: string, options?: {
	candidates?: readonly CandidateReference[];
	canonical?: CandidateReference;
}) => Promise<TierSource[]>;

export function initListAvailableTierSources(deps: {
	readTierSource: ReadTierSource;
}): { listAvailableTierSources: ListAvailableTierSources } {
	const { readTierSource } = deps;

	const listAvailableTierSources: ListAvailableTierSources = async (url, options) => {
		const refs = KNOWN_TIERS.flatMap<{ tier: Tier; candidateId: CandidateId | undefined }>((tier) => {
			const fresh = options?.candidates?.filter((source) => source.tier === tier);
			return fresh?.length ? fresh.map((source) => ({ tier, candidateId: source.id })) : [{ tier, candidateId: undefined }];
		});
		if (options?.canonical && !refs.some((ref) => ref.candidateId === options.canonical?.id)) {
			refs.push({ tier: options.canonical.tier, candidateId: options.canonical.id });
		}
		const reads = await Promise.all(
			refs.map(({ tier, candidateId }) => readTierSource({ url, tier, ...(candidateId === undefined ? {} : { candidateId }) })),
		);
		const present = reads.filter((source): source is TierSource => source !== undefined);
		return present.filter((source, index) => source.metadata.id === undefined || present.findIndex((other) => other.metadata.id === source.metadata.id) === index);
	};

	return { listAvailableTierSources };
}
