import type { InboxAddress } from "../inbox/inbox-address.schema";
import type { ForwardableSender } from "./build-forwarding-filter-query";
import type { GmailSenderEntry } from "./gmail-sender.types";

export interface GmailDestinationGroup {
	forwardTo: InboxAddress;
	senders: ForwardableSender[];
}

export function groupSendersByDestination(input: {
	senders: readonly GmailSenderEntry[];
	gateway: InboxAddress;
}): GmailDestinationGroup[] {
	const byDestination = new Map<InboxAddress, ForwardableSender[]>();
	for (const sender of input.senders) {
		if (sender.addedToFilterAt === undefined) continue;
		const forwardTo = sender.mappedAddress ?? input.gateway;
		const existing = byDestination.get(forwardTo);
		if (existing === undefined) byDestination.set(forwardTo, [sender.senderEmail]);
		else existing.push(sender.senderEmail);
	}
	return [...byDestination].map(([forwardTo, senders]) => ({ forwardTo, senders }));
}
