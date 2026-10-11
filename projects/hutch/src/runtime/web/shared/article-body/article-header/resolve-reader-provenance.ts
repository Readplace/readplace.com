import type { SaveProvenance } from "@packages/domain/article";
import { type ForwardableSender, parseForwardableSender } from "@packages/domain/gmail";
import type { DetectNewsletters } from "@packages/domain/newsletter-catalog";
import type { ReaderProvenance } from "./provenance-label";

export type ResolveReaderProvenance = (provenance: SaveProvenance | undefined) => Promise<ReaderProvenance | undefined>;

export type ResolveReaderProvenances = (
	provenances: readonly (SaveProvenance | undefined)[],
) => Promise<(ReaderProvenance | undefined)[]>;

function forwardableSenderOf(provenance: SaveProvenance | undefined): ForwardableSender | undefined {
	return provenance?.kind === "email" ? parseForwardableSender(provenance.senderEmail) : undefined;
}

export function initResolveReaderProvenances(deps: { detectNewsletters: DetectNewsletters }): ResolveReaderProvenances {
	return async (provenances) => {
		const senders = provenances.map(forwardableSenderOf);
		const forwardable = [...new Set(senders.filter((sender) => sender !== undefined))];
		if (forwardable.length === 0) return [...provenances];
		const detection = await deps.detectNewsletters(forwardable);
		if (detection.status === "unavailable") return [...provenances];
		return provenances.map((provenance, index) => {
			const sender = senders[index];
			if (sender === undefined) return provenance;
			const name = detection.recognized.get(sender)?.name;
			return name === undefined ? provenance : { kind: "newsletter", name, senderEmail: sender };
		});
	};
}

export function initResolveReaderProvenance(deps: { detectNewsletters: DetectNewsletters }): ResolveReaderProvenance {
	const resolveReaderProvenances = initResolveReaderProvenances(deps);
	return async (provenance) => (await resolveReaderProvenances([provenance]))[0];
}
