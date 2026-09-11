import type {
	ForwardableSender,
	GmailConnectionStore,
	GmailFilterErrorCode,
	GmailSenderStore,
} from "@packages/domain/gmail";
import { buildForwardingFilterQuery, groupSendersByDestination } from "@packages/domain/gmail";
import type { InboxAddressStore } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type { GmailApiFailure, GmailFilter, GmailFilters } from "@packages/provider-contracts/gmail-filters";
import type { HutchLogger } from "@packages/hutch-logger";

export type RewriteGmailFilterOutcome =
	| { ok: true; filterCount: number; senderCount: number }
	| { ok: false; reason: "not-connected" }
	| { ok: false; reason: "not-confirmed" }
	| { ok: false; reason: "reauth-required" }
	| { ok: false; reason: "query-too-long"; message: string }
	| { ok: false; reason: "rejected"; message: string }
	| { ok: false; reason: "unavailable"; status: number };

type GroupApiFailure =
	| { ok: false; reason: "reauth-required" }
	| { ok: false; reason: "query-too-long"; message: string }
	| { ok: false; reason: "rejected"; message: string }
	| { ok: false; reason: "unavailable"; status: number };

type GroupOutcome = { ok: true; filterCount: 0 | 1; senderCount: number } | GroupApiFailure;

type RecordableFailure = Extract<GroupApiFailure, { reason: "query-too-long" | "rejected" }>;

export type RewriteGmailFilter = (input: {
	userId: UserId;
}) => Promise<RewriteGmailFilterOutcome>;

export function initRewriteGmailFilter(deps: {
	filters: GmailFilters;
	connections: GmailConnectionStore;
	senders: GmailSenderStore;
	addresses: InboxAddressStore;
	now: () => Date;
	logger: HutchLogger;
}): RewriteGmailFilter {
	const { filters, connections, senders, addresses, now, logger } = deps;

	function surfaceApiFailure(userId: UserId, failure: GmailApiFailure): Promise<GroupApiFailure> {
		if (failure.reason === "unavailable") {
			return Promise.resolve({ ok: false, reason: "unavailable", status: failure.status });
		}
		if (failure.reason === "reauth-required") {
			return connections
				.markRevoked({ userId, reason: "invalid-grant" })
				.then(() => ({ ok: false, reason: "reauth-required" }));
		}
		return Promise.resolve({ ok: false, reason: "rejected", message: failure.message });
	}

	async function recordError(
		userId: UserId,
		error: { code: GmailFilterErrorCode; message: string },
	) {
		await connections.recordFilterError({
			userId,
			error: { code: error.code, message: error.message, at: now().toISOString() },
		});
	}

	async function reconcileGroup(input: {
		userId: UserId;
		forwardTo: string;
		senders: ForwardableSender[];
		ours: GmailFilter[];
	}): Promise<GroupOutcome> {
		const { userId, forwardTo, senders: groupSenders, ours } = input;
		const built = buildForwardingFilterQuery({ senders: groupSenders });
		if (!built.query.ok) {
			if (built.query.reason === "too-long") {
				const message = `Inbox ${forwardTo}: ${built.query.senderCount} senders produce a ${built.query.length}-character query`;
				return { ok: false, reason: "query-too-long", message };
			}
			for (const filter of ours) {
				const removed = await filters.deleteFilter({ userId, filterId: filter.id });
				if (!removed.ok) return surfaceApiFailure(userId, removed);
			}
			return { ok: true, filterCount: 0, senderCount: 0 };
		}

		const { query, senders: accepted } = built.query;
		const live = ours.find((filter) => filter.query === query);
		if (live !== undefined && ours.length === 1) {
			return { ok: true, filterCount: 1, senderCount: accepted.length };
		}

		const created = await filters.createForwardingFilter({ userId, query, forwardTo });
		if (!created.ok) return surfaceApiFailure(userId, created);

		const readBack = await filters.getFilter({ userId, filterId: created.value.id });
		if (!readBack.ok) return surfaceApiFailure(userId, readBack);
		if (readBack.value.query !== query) {
			await filters.deleteFilter({ userId, filterId: created.value.id });
			const message = `Gmail stored a different query than the one sent (${readBack.value.query ?? "none"})`;
			return { ok: false, reason: "rejected", message };
		}

		for (const filter of ours) {
			const removed = await filters.deleteFilter({ userId, filterId: filter.id });
			if (!removed.ok) return surfaceApiFailure(userId, removed);
			logger.info("[rewrite-gmail-filter] replaced filter", {
				userId,
				removedFilterId: filter.id,
				removedQuery: filter.query,
			});
		}
		return { ok: true, filterCount: 1, senderCount: accepted.length };
	}

	return async ({ userId }) => {
		const connection = await connections.findConnectionByUserId(userId);
		if (connection === undefined) return { ok: false, reason: "not-connected" };
		if (connection.revokedAt !== undefined) return { ok: false, reason: "reauth-required" };
		if (connection.forwardingConfirmedAt === undefined) {
			return { ok: false, reason: "not-confirmed" };
		}
		const gateway: string = connection.gatewayAddress;

		const listed = await filters.listFilters({ userId });
		if (!listed.ok) {
			const failure = await surfaceApiFailure(userId, listed);
			if (failure.reason === "rejected") await recordError(userId, { code: "rejected", message: failure.message });
			return failure;
		}

		const addressRows = await addresses.listAddressesByUserId(userId);
		const ownedAddresses = new Set<string>([gateway, ...addressRows.map((row) => row.address)]);
		const groups = groupSendersByDestination({
			senders: await senders.listSendersByUserId(userId),
			gateway: connection.gatewayAddress,
		});
		const gatewaySenders: ForwardableSender[] = [];
		const sendersByDestination = new Map<string, ForwardableSender[]>();
		for (const group of groups) {
			if (group.forwardTo === gateway) {
				gatewaySenders.push(...group.senders);
				continue;
			}
			const address = await addresses.findByAddress(group.forwardTo);
			if (address?.userId === userId) {
				ownedAddresses.add(address.address);
				if (address.gmailConfirmedAt !== undefined) {
					sendersByDestination.set(group.forwardTo, group.senders);
					continue;
				}
			}
			gatewaySenders.push(...group.senders);
		}
		sendersByDestination.set(gateway, gatewaySenders);
		const owned = listed.value.filter(
			(filter): filter is GmailFilter & { forwardTo: string } =>
				filter.forwardTo !== undefined && ownedAddresses.has(filter.forwardTo),
		);
		const destinations = new Set<string>([
			...sendersByDestination.keys(),
			...owned.map((filter) => filter.forwardTo),
		]);
		destinations.delete(gateway);
		destinations.add(gateway);

		let firstFailure: RecordableFailure | undefined;
		let filterCount = 0;
		let senderCount = 0;
		for (const destination of destinations) {
			if (destination === gateway && firstFailure !== undefined) return firstFailure;
			const result = await reconcileGroup({
				userId,
				forwardTo: destination,
				senders: sendersByDestination.get(destination) ?? [],
				ours: owned.filter((filter) => filter.forwardTo === destination),
			});
			if (!result.ok) {
				if (result.reason === "unavailable" || result.reason === "reauth-required") return result;
				if (firstFailure === undefined) {
					await recordError(userId, { code: result.reason, message: result.message });
					firstFailure = result;
				}
				continue;
			}
			filterCount += result.filterCount;
			senderCount += result.senderCount;
		}

		if (firstFailure !== undefined) return firstFailure;
		if (filterCount === 0) {
			await connections.clearFilter({ userId });
			return { ok: true, filterCount: 0, senderCount: 0 };
		}
		await connections.recordFilter({ userId, filterCount, filterSenderCount: senderCount });
		return { ok: true, filterCount, senderCount };
	};
}
