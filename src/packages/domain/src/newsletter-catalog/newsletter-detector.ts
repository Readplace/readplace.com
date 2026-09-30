import type { ForwardableSender } from "../gmail/build-forwarding-filter-query";
import type { NewsletterCatalogDocument, NewsletterCatalogRecord, NewsletterName } from "./newsletter-catalog.schema";

export type NewsletterRecognition = { from: ForwardableSender; name: NewsletterName | undefined; source: "catalog" };

export type NewsletterDetection =
	| { status: "available"; recognized: ReadonlyMap<ForwardableSender, NewsletterRecognition> }
	| { status: "unavailable" };

export type DetectNewsletters = (senders: readonly ForwardableSender[]) => Promise<NewsletterDetection>;

export function initNewsletterDetectorChain(deps: { detectors: readonly DetectNewsletters[] }): DetectNewsletters {
	return async (senders) => {
		const recognized = new Map<ForwardableSender, NewsletterRecognition>();
		for (const detect of deps.detectors) {
			const detection = await detect(senders.filter((sender) => !recognized.has(sender)));
			if (detection.status === "unavailable") return detection;
			for (const [sender, recognition] of detection.recognized) recognized.set(sender, recognition);
		}
		return { status: "available", recognized };
	};
}

export function initCatalogNewsletterDetector(deps: {
	readCatalog: () => Promise<{ ok: true; document: NewsletterCatalogDocument } | { ok: false; reason: "unavailable" }>;
}): DetectNewsletters {
	return async (senders) => {
		const catalog = await deps.readCatalog();
		if (!catalog.ok) return { status: "unavailable" };
		const approved = new Map<string, NewsletterCatalogRecord>();
		for (const record of catalog.document.records) {
			if (record.status === "approved") approved.set(record.from, record);
		}
		const recognized = new Map<ForwardableSender, NewsletterRecognition>();
		for (const sender of senders) {
			const domainWildcard = `*${sender.slice(sender.indexOf("@"))}`;
			const record = approved.get(sender) ?? approved.get(domainWildcard);
			if (record === undefined) continue;
			recognized.set(sender, { from: sender, name: record.name, source: "catalog" });
		}
		return { status: "available", recognized };
	};
}
