import assert from "node:assert";
import {
	DEFAULT_READLIST_SLUG,
	type ReadlistSlug,
} from "../readlist/readlist-name.schema";
import type { ForwardableSender } from "./build-forwarding-filter-query";
import {
	type GmailDeliveryMode,
	NEW_MAPPING_DELIVERY_MODE,
} from "./gmail-delivery-mode";

export type GmailSenderRouting =
	| { kind: "unmapped" | "unrouted"; deliveryMode: GmailDeliveryMode }
	| {
			kind: "routed";
			readlists: ReadlistSlug[];
			deliveryMode: GmailDeliveryMode;
		}
	| { kind: "unresolved" };

export interface GmailReadlistSelectionChange {
	sender: ForwardableSender;
	readlists: ReadlistSlug[];
	deliveryMode: GmailDeliveryMode;
	newToFilter: boolean;
}

export type GmailReadlistSelectionRejection =
	| "unknown-readlist"
	| "sender-unknown"
	| "sender-unresolved";

export type GmailReadlistSelectionDecision =
	| { ok: true; changes: GmailReadlistSelectionChange[] }
	| { ok: false; reason: GmailReadlistSelectionRejection };

function sortedUnique(
	senders: readonly ForwardableSender[],
): ForwardableSender[] {
	return [...new Set(senders)].sort();
}

function routesHere(
	routing: GmailSenderRouting | undefined,
	slug: ReadlistSlug,
): boolean {
	return routing?.kind === "routed" && routing.readlists.includes(slug);
}

function addition(params: {
	sender: ForwardableSender;
	slug: ReadlistSlug;
	routing: GmailSenderRouting | undefined;
}): GmailReadlistSelectionChange {
	const { sender, slug, routing } = params;
	if (routing === undefined) {
		return {
			sender,
			readlists: [slug],
			deliveryMode: NEW_MAPPING_DELIVERY_MODE,
			newToFilter: true,
		};
	}
	assert(
		routing.kind !== "unresolved",
		"an unresolved sender is rejected before any change is decided",
	);
	if (routing.kind === "routed") {
		return {
			sender,
			readlists: [...routing.readlists, slug],
			deliveryMode: routing.deliveryMode,
			newToFilter: false,
		};
	}
	return {
		sender,
		readlists: [slug],
		deliveryMode: routing.deliveryMode,
		newToFilter: true,
	};
}

export function decideGmailReadlistSelection(params: {
	slug: ReadlistSlug;
	readlists: readonly { slug: ReadlistSlug }[];
	ticked: readonly ForwardableSender[];
	routed: readonly ForwardableSender[];
	known: ReadonlySet<ForwardableSender>;
	routing: ReadonlyMap<ForwardableSender, GmailSenderRouting>;
}): GmailReadlistSelectionDecision {
	const { slug, known, routing } = params;
	if (slug === DEFAULT_READLIST_SLUG)
		return { ok: false, reason: "unknown-readlist" };
	if (!params.readlists.some((readlist) => readlist.slug === slug)) {
		return { ok: false, reason: "unknown-readlist" };
	}
	const ticked = sortedUnique(params.ticked);
	if (ticked.some((sender) => !known.has(sender)))
		return { ok: false, reason: "sender-unknown" };
	if (ticked.some((sender) => routing.get(sender)?.kind === "unresolved")) {
		return { ok: false, reason: "sender-unresolved" };
	}
	const tickedSet = new Set(ticked);
	const additions = ticked
		.filter((sender) => !routesHere(routing.get(sender), slug))
		.map((sender) => addition({ sender, slug, routing: routing.get(sender) }));
	const removals = sortedUnique(params.routed).flatMap(
		(sender): GmailReadlistSelectionChange[] => {
			const current = routing.get(sender);
			if (
				tickedSet.has(sender) ||
				current?.kind !== "routed" ||
				!current.readlists.includes(slug)
			)
				return [];
			return [
				{
					sender,
					readlists: current.readlists.filter((readlist) => readlist !== slug),
					deliveryMode: current.deliveryMode,
					newToFilter: false,
				},
			];
		},
	);
	return { ok: true, changes: [...additions, ...removals] };
}
