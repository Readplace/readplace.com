import type { SaveProvenance } from "@packages/domain/article";
import { parseForwardableSender } from "@packages/domain/gmail";
import type { DetectNewsletters } from "@packages/domain/newsletter-catalog";
import type { ReaderProvenance } from "./provenance-label";

export type ResolveReaderProvenance = (provenance: SaveProvenance | undefined) => Promise<ReaderProvenance | undefined>;

export function initResolveReaderProvenance(deps: { detectNewsletters: DetectNewsletters }): ResolveReaderProvenance {
	return async (provenance) => {
		if (provenance?.kind !== "email") return provenance;
		const sender = parseForwardableSender(provenance.senderEmail);
		if (sender === undefined) return provenance;
		const detection = await deps.detectNewsletters([sender]);
		if (detection.status === "unavailable") return provenance;
		const name = detection.recognized.get(sender)?.name;
		return name === undefined ? provenance : { kind: "newsletter", name };
	};
}
