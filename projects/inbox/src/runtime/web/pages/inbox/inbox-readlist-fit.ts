import type {
	EmailLinkOrdinal,
	InboxEmailLinksMeta,
	InboxReadlistOutcome,
} from "@packages/domain/inbox";
import type { ReadlistSlug } from "@packages/domain/readlist";
import type { ReadlistFitOverride } from "@packages/provider-contracts/article-store";

export type ReadlistFitOverridesByReadlist = ReadonlyMap<
	ReadlistSlug,
	readonly ReadlistFitOverride[]
>;

export function readlistOutcomeFor(input: {
	outcomes: readonly InboxReadlistOutcome[];
	readlist: ReadlistSlug;
	ordinal?: EmailLinkOrdinal;
}): InboxReadlistOutcome | undefined {
	const outcomes = input.outcomes.filter((outcome) => outcome.readlist === input.readlist)
		.sort((left, right) => (left.startIndex ?? 0) - (right.startIndex ?? 0));
	if (input.ordinal !== undefined) {
		const index = Number(input.ordinal);
		return outcomes.reverse().find((outcome) => (outcome.startIndex ?? 0) <= index);
	}
	const initial = outcomes[0];
	if (initial === undefined || outcomes.length === 1) return initial;
	const latest = outcomes[outcomes.length - 1];
	if (latest.decision === "failed") return latest;
	const filtered = outcomes.find((outcome) => outcome.decision === "filtered");
	return filtered ? { ...filtered, fit: outcomes.flatMap((outcome) => outcome.fit) } : latest;
}

export function currentReadlistFitOverride(params: {
	overrides: readonly ReadlistFitOverride[];
	emailId: string;
	ordinal: EmailLinkOrdinal;
}): ReadlistFitOverride | undefined {
	return params.overrides.find(
		(override) =>
			override.receivedAtMessageId === params.emailId &&
			override.ordinal === params.ordinal,
	);
}

export function fitsReadlist(params: {
	outcome: InboxReadlistOutcome;
	overrides: readonly ReadlistFitOverride[];
	emailId: string;
	ordinal: EmailLinkOrdinal;
}): boolean {
	const override = currentReadlistFitOverride(params);
	if (override !== undefined) return override.readerVerdict === "keep";
	return params.outcome.fit.some(
		(entry) => entry.ordinal === params.ordinal && entry.verdict === "keep",
	);
}

export type InboxLinkCardReadlistFit = {
	readlist: ReadlistSlug;
	label: string;
	outcome: InboxReadlistOutcome;
	override: ReadlistFitOverride | undefined;
};

export function cardReadlistFits(params: {
	meta: InboxEmailLinksMeta | undefined;
	fitOverrides: ReadlistFitOverridesByReadlist;
	emailId: string;
	ordinal: EmailLinkOrdinal;
}): InboxLinkCardReadlistFit[] {
	if (params.meta?.savesHeld === true) return [];
	const outcomes = params.meta?.readlistOutcomes ?? [];
	return (params.meta?.selectedReadlists ?? []).flatMap(({ readlist, label }) => {
		const outcome = readlistOutcomeFor({ outcomes, readlist, ordinal: params.ordinal });
		if (outcome === undefined) return [];
		return [
			{
				readlist,
				label,
				outcome,
				override: currentReadlistFitOverride({
					overrides: params.fitOverrides.get(readlist) ?? [],
					emailId: params.emailId,
					ordinal: params.ordinal,
				}),
			},
		];
	});
}
