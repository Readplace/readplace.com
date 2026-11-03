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
		const outcome = outcomes.find((entry) => entry.readlist === readlist);
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
