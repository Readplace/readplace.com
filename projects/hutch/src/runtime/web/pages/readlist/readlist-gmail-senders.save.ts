import assert from "node:assert";
import {
	type DiscoveredGmailSender,
	decideGmailReadlistSelection,
	ForwardableSenderSchema,
	type GmailMapping,
	type GmailSenderPool,
	type GmailSenderRouting,
	gmailSenderPool,
	hasGmailScope,
	type ForwardableSender,
} from "@packages/domain/gmail";
import type { InboxAddressEntry } from "@packages/domain/inbox";
import { type ReadlistSlug, readerReadlists } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type { ListReadlistDefinitions } from "@packages/provider-contracts/article-store";
import { GMAIL_METADATA_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import type { GetEffectiveAccess } from "@packages/subscription-access";
import { z } from "zod";
import type { MapSenderToReadlist } from "../../../domain/gmail/resolve-readlist-mapping";
import { canConnectGmail } from "../integrations/gmail-connection-access";
import { destinationLookups } from "../integrations/gmail-destination-lookups";
import type { GmailIntegrationDependencies } from "../integrations/gmail-integration.types";
import { discoveryMatchesConnection } from "../integrations/gmail-save-senders";
import type { SubmitNewsletterSenders } from "../integrations/gmail-submit-newsletter-senders";
import {
	gmailSenderRoutingFor,
	type ReadlistGmailSectionState,
	type ReadlistGmailSectionStateInput,
	readlistGmailPickerVisible,
	readlistGmailSectionState,
} from "./readlist-gmail-senders.viewmodel";

const SendersFieldSchema = z
	.union([ForwardableSenderSchema, z.array(ForwardableSenderSchema)])
	.optional()
	.transform((value) => [...new Set(value === undefined ? [] : typeof value === "string" ? [value] : value)]);

const SaveBodySchema = z.object({
	gmail_selection: z.literal("1"),
	sender: SendersFieldSchema,
	routed: SendersFieldSchema,
	shown: SendersFieldSchema,
	select: z.enum(["all", "none"]).optional(),
	pick: ForwardableSenderSchema.optional(),
});

const TICKS: Record<"all" | "none" | "each", (body: z.infer<typeof SaveBodySchema>) => ForwardableSender[]> = {
	all: (body) => body.shown,
	none: () => [],
	each: (body) => body.sender,
};

function tickedSenders(body: z.infer<typeof SaveBodySchema>): ForwardableSender[] {
	const ticked = TICKS[body.select ?? "each"](body);
	return [...new Set(body.pick === undefined ? ticked : [...ticked, body.pick])];
}

export interface ReadlistGmailSources extends ReadlistGmailSectionStateInput {
	state: ReadlistGmailSectionState;
	mappings: GmailMapping[];
	pool: GmailSenderPool;
	destinations: Map<string, InboxAddressEntry>;
}

export type ReadReadlistGmailSources = (userId: UserId) => Promise<ReadlistGmailSources>;

export function initReadReadlistGmailSources(deps: {
	gmail: GmailIntegrationDependencies;
	getEffectiveAccess: GetEffectiveAccess;
}): ReadReadlistGmailSources {
	const { gmail } = deps;
	return async (userId) => {
		const [connection, grantedScope, discovery, discovered, access] = await Promise.all([
			gmail.gmailConnectionStore.findConnectionByUserId(userId),
			gmail.gmailCredentialsStore.findGrantedScopeByUserId(userId),
			gmail.gmailDiscoveryStore.findDiscoveryByUserId(userId),
			gmail.gmailDiscoveryStore.listSendersByUserId(userId),
			deps.getEffectiveAccess(userId),
		]);
		const stateInput: ReadlistGmailSectionStateInput = {
			connection,
			canConnectGmail: canConnectGmail(access),
			metadataScopeGranted: hasGmailScope({ grantedScope, scope: GMAIL_METADATA_SCOPE }),
			discovery,
		};
		const accountEmail = connection?.accountEmail;
		const [mappings, observed]: [GmailMapping[], DiscoveredGmailSender[]] = accountEmail === undefined ? [[], []] : await Promise.all([
			gmail.gmailMappingStore.listMappings({ userId, accountEmail }),
			gmail.gmailMonitoringStore.listObservedSenders({ userId, accountEmail }),
		]);
		const sameMailbox = connection !== undefined && discoveryMatchesConnection(discovery, connection);
		const lookups = connection === undefined ? [] : destinationLookups({ connection, mapped: mappings.flatMap((mapping) => mapping.mappedAddresses ?? []) });
		const entries = await Promise.all(lookups.map((address) => gmail.findInboxAddress(address)));
		return {
			...stateInput,
			state: readlistGmailSectionState(stateInput),
			mappings,
			pool: gmailSenderPool({ observed, discovered, sameMailbox, mappings }),
			destinations: new Map(entries.flatMap((entry): [string, InboxAddressEntry][] => (entry === undefined ? [] : [[entry.address, entry]]))),
		};
	};
}

export type SaveReadlistGmailSendersRejection = "unknown-readlist" | "gmail-selection" | "gmail-unavailable";

type SaveReadlistGmailSendersOutcome = { ok: true } | { ok: false; reason: SaveReadlistGmailSendersRejection };

export type SaveReadlistGmailSenders = (input: { userId: UserId; slug: ReadlistSlug; body: unknown }) => Promise<SaveReadlistGmailSendersOutcome>;

const REJECTIONS: Record<"unknown-readlist" | "sender-unknown" | "sender-unresolved", SaveReadlistGmailSendersOutcome> = {
	"unknown-readlist": { ok: false, reason: "unknown-readlist" },
	"sender-unknown": { ok: false, reason: "gmail-selection" },
	"sender-unresolved": { ok: false, reason: "gmail-selection" },
};

export function initSaveReadlistGmailSenders(deps: {
	gmail: GmailIntegrationDependencies;
	listReadlistDefinitions: ListReadlistDefinitions;
	readSources: ReadReadlistGmailSources;
	mapSenderToReadlist: MapSenderToReadlist;
	submitNewsletterSenders: SubmitNewsletterSenders;
}): SaveReadlistGmailSenders {
	return async ({ userId, slug, body }) => {
		const parsed = SaveBodySchema.safeParse(body);
		if (!parsed.success) return { ok: false, reason: "gmail-selection" };
		const [definitions, sources] = await Promise.all([deps.listReadlistDefinitions(userId), deps.readSources(userId)]);
		if (!readlistGmailPickerVisible(sources.state)) return { ok: false, reason: "gmail-unavailable" };
		const accountEmail = sources.connection?.accountEmail;
		assert(accountEmail, "a picker-visible Gmail section requires a recorded Gmail account");
		const readlists = readerReadlists(definitions);
		const routing: ReadonlyMap<ForwardableSender, GmailSenderRouting> = gmailSenderRoutingFor({
			mappings: sources.mappings,
			userId,
			destinations: sources.destinations,
			readlists,
		});
		const decision = decideGmailReadlistSelection({
			slug,
			readlists,
			ticked: tickedSenders(parsed.data),
			routed: parsed.data.routed,
			known: sources.pool.known,
			routing,
		});
		if (!decision.ok) return REJECTIONS[decision.reason];
		for (const change of decision.changes) {
			await deps.mapSenderToReadlist({
				userId,
				accountEmail,
				sender: change.sender,
				readlists: change.readlists,
				deliveryMode: change.deliveryMode,
			});
		}
		if (decision.changes.length > 0) {
			await deps.gmail.publishRewriteGmailFilter({ userId, reason: "sender-added" });
		}
		const newToFilter = decision.changes.filter((change) => change.newToFilter).map((change) => change.sender);
		if (newToFilter.length > 0) await deps.submitNewsletterSenders(newToFilter);
		return { ok: true };
	};
}
