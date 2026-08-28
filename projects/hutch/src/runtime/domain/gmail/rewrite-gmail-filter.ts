import type { GmailConnectionStore, GmailSenderStore } from "@packages/domain/gmail";
import { buildForwardingFilterQuery } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import type { GmailApiFailure, GmailFilters } from "@packages/provider-contracts/gmail-filters";
import type { HutchLogger } from "@packages/hutch-logger";

export type RewriteGmailFilterOutcome =
	| { ok: true; filterId: string | undefined; senderCount: number }
	| { ok: false; reason: "not-connected" }
	| { ok: false; reason: "not-confirmed" }
	| { ok: false; reason: "reauth-required" }
	| { ok: false; reason: "query-too-long"; message: string }
	| { ok: false; reason: "rejected"; message: string }
	| { ok: false; reason: "unavailable"; status: number };

export type RewriteGmailFilter = (input: {
	userId: UserId;
}) => Promise<RewriteGmailFilterOutcome>;

export function initRewriteGmailFilter(deps: {
	filters: GmailFilters;
	connections: GmailConnectionStore;
	senders: GmailSenderStore;
	now: () => Date;
	logger: HutchLogger;
}): RewriteGmailFilter {
	const { filters, connections, senders, now, logger } = deps;

	async function surfaceApiFailure(
		userId: UserId,
		failure: GmailApiFailure,
	): Promise<RewriteGmailFilterOutcome> {
		if (failure.reason === "unavailable") return { ok: false, ...failure };
		if (failure.reason === "reauth-required") {
			await connections.markRevoked({ userId, reason: "invalid-grant" });
			return { ok: false, reason: "reauth-required" };
		}
		await connections.recordFilterError({
			userId,
			error: { code: "rejected", message: failure.message, at: now().toISOString() },
		});
		return { ok: false, reason: "rejected", message: failure.message };
	}

	return async ({ userId }) => {
		const connection = await connections.findConnectionByUserId(userId);
		if (connection === undefined) return { ok: false, reason: "not-connected" };
		if (connection.revokedAt !== undefined) return { ok: false, reason: "reauth-required" };
		if (connection.forwardingConfirmedAt === undefined) {
			return { ok: false, reason: "not-confirmed" };
		}
		const gatewayAddress = connection.gatewayAddress;

		const listed = await filters.listFilters({ userId });
		if (!listed.ok) return surfaceApiFailure(userId, listed);
		const ours = listed.value.filter((filter) => filter.forwardTo === gatewayAddress);

		const onFilter = (await senders.listSendersByUserId(userId)).filter(
			(sender) => sender.addedToFilterAt !== undefined,
		);
		const built = buildForwardingFilterQuery({
			senders: onFilter.map((sender) => sender.senderEmail),
		});
		if (!built.query.ok) {
			if (built.query.reason === "too-long") {
				const message = `${built.query.senderCount} senders produce a ${built.query.length}-character query`;
				await connections.recordFilterError({
					userId,
					error: { code: "query-too-long", message, at: now().toISOString() },
				});
				return { ok: false, reason: "query-too-long", message };
			}
			for (const filter of ours) {
				const removed = await filters.deleteFilter({ userId, filterId: filter.id });
				if (!removed.ok) return surfaceApiFailure(userId, removed);
			}
			await connections.clearFilter({ userId });
			return { ok: true, filterId: undefined, senderCount: 0 };
		}

		const { query, senders: accepted } = built.query;
		const live = ours.find((filter) => filter.query === query);
		if (live !== undefined && ours.length === 1) {
			await connections.recordFilter({
				userId,
				filterId: live.id,
				filterQuery: query,
				filterSenderCount: accepted.length,
			});
			return { ok: true, filterId: live.id, senderCount: accepted.length };
		}

		const created = await filters.createForwardingFilter({
			userId,
			query,
			forwardTo: gatewayAddress,
		});
		if (!created.ok) return surfaceApiFailure(userId, created);

		const readBack = await filters.getFilter({ userId, filterId: created.value.id });
		if (!readBack.ok) return surfaceApiFailure(userId, readBack);
		if (readBack.value.query !== query) {
			await filters.deleteFilter({ userId, filterId: created.value.id });
			const message = `Gmail stored a different query than the one sent (${readBack.value.query ?? "none"})`;
			await connections.recordFilterError({
				userId,
				error: { code: "rejected", message, at: now().toISOString() },
			});
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

		await connections.recordFilter({
			userId,
			filterId: created.value.id,
			filterQuery: query,
			filterSenderCount: accepted.length,
		});
		return { ok: true, filterId: created.value.id, senderCount: accepted.length };
	};
}
