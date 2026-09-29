import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "../readlist/readlist-name.schema";
import { isCappedAddress, isLiveAddress } from "./inbox-address.live";
import { type InboxAddress, InboxAddressSchema } from "./inbox-address.schema";
import type { InboxAddressEntry } from "./inbox-address.types";

export type InboxRoutingRejection = "unknown-readlist" | "unknown-inbox" | "invalid-destination";

export type InboxRoutingDecision =
	| { ok: true; address: InboxAddress; readlist: ReadlistSlug | undefined }
	| { ok: false; reason: InboxRoutingRejection };

export function decideInboxRouting(params: {
	slug: ReadlistSlug;
	address: string;
	destination: string;
	inboxes: readonly InboxAddressEntry[];
	readlists: readonly { slug: ReadlistSlug }[];
}): InboxRoutingDecision {
	if (params.slug === DEFAULT_READLIST_SLUG) return { ok: false, reason: "unknown-readlist" };
	if (!params.readlists.some((readlist) => readlist.slug === params.slug)) {
		return { ok: false, reason: "unknown-readlist" };
	}
	const address = InboxAddressSchema.safeParse(params.address);
	if (!address.success) return { ok: false, reason: "unknown-inbox" };
	const routable = params.inboxes.some(
		(inbox) => inbox.address === address.data && isLiveAddress(inbox) && isCappedAddress(inbox),
	);
	if (!routable) return { ok: false, reason: "unknown-inbox" };
	if (params.destination !== params.slug && params.destination !== DEFAULT_READLIST_SLUG) {
		return { ok: false, reason: "invalid-destination" };
	}
	return {
		ok: true,
		address: address.data,
		readlist: params.destination === params.slug ? params.slug : undefined,
	};
}
