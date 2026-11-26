import type { ForwardableSender } from "../gmail/build-forwarding-filter-query";
import {
	domainWildcardOf,
	type NewsletterCatalogDocument,
	type NewsletterCatalogRecord,
	type NewsletterFrom,
	type NewsletterName,
} from "./newsletter-catalog.schema";

export type NewsletterRecognition = {
	from: ForwardableSender;
	name: NewsletterName | undefined;
	match: "exact" | "domain-wildcard";
};

export type NewsletterDetection =
	| { status: "available"; recognized: ReadonlyMap<ForwardableSender, NewsletterRecognition> }
	| { status: "unavailable" };

export type DetectNewsletters = (senders: readonly ForwardableSender[]) => Promise<NewsletterDetection>;

function decidingRecord(
	verdicts: ReadonlyMap<NewsletterFrom, NewsletterCatalogRecord>,
	sender: ForwardableSender,
): { record: NewsletterCatalogRecord; match: NewsletterRecognition["match"] } | undefined {
	const exact = verdicts.get(sender);
	if (exact !== undefined) return { record: exact, match: "exact" };
	const wildcard = verdicts.get(domainWildcardOf(sender));
	if (wildcard !== undefined) return { record: wildcard, match: "domain-wildcard" };
	return undefined;
}

export function initCatalogNewsletterDetector(deps: {
	readCatalog: () => Promise<{ ok: true; document: NewsletterCatalogDocument } | { ok: false; reason: "unavailable" }>;
}): DetectNewsletters {
	return async (senders) => {
		const catalog = await deps.readCatalog();
		if (!catalog.ok) return { status: "unavailable" };
		const verdicts = new Map<NewsletterFrom, NewsletterCatalogRecord>();
		for (const record of catalog.document.records) {
			if (record.replacedBy === undefined) verdicts.set(record.from, record);
		}
		const recognized = new Map<ForwardableSender, NewsletterRecognition>();
		for (const sender of senders) {
			const decided = decidingRecord(verdicts, sender);
			if (decided?.record.status !== "approved") continue;
			recognized.set(sender, { from: sender, name: decided.record.name, match: decided.match });
		}
		return { status: "available", recognized };
	};
}
