import type { ForwardableSender } from "./build-forwarding-filter-query";
import type { DiscoveredGmailSender } from "./gmail-discovery.types";
import type { GmailMapping } from "./gmail-mapping.types";

export interface GmailSenderPool {
	senders: DiscoveredGmailSender[];
	known: ReadonlySet<ForwardableSender>;
}

export function gmailSenderPool(input: {
	observed: readonly DiscoveredGmailSender[];
	discovered: readonly DiscoveredGmailSender[];
	sameMailbox: boolean;
	mappings: readonly Pick<GmailMapping, "senderEmail" | "addedToFilterAt">[];
}): GmailSenderPool {
	const pooled = [...input.observed, ...(input.sameMailbox ? input.discovered : [])];
	const senders = [...new Map(pooled.map((sender) => [sender.email, sender])).values()];
	const known = new Set<ForwardableSender>([
		...senders.map((sender) => sender.email),
		...input.mappings.filter((mapping) => mapping.addedToFilterAt !== undefined).map((mapping) => mapping.senderEmail),
	]);
	return { senders, known };
}
