import assert from "node:assert";

const VISITOR_HASH_SHAPE = /^[a-f0-9]+$/;
const VISITOR_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const USER_ID_SHAPE = /^[0-9a-f]{32}$/;

export interface ExcludedIdentities {
	excludedVisitorHashes: readonly string[];
	excludedVisitorIds: readonly string[];
	excludedUserIds: readonly string[];
}

export function assertExcludedVisitorHashes(hashes: readonly string[]): void {
	for (const hash of hashes) {
		assert(
			VISITOR_HASH_SHAPE.test(hash),
			`excludedVisitorHashes entries must be lowercase hex (got: ${hash})`,
		);
	}
}

export function assertExcludedVisitorIds(visitorIds: readonly string[]): void {
	for (const visitorId of visitorIds) {
		assert(
			VISITOR_ID_SHAPE.test(visitorId),
			`excludedVisitorIds entries must be lowercase UUIDs (got: ${visitorId})`,
		);
	}
}

export function assertExcludedUserIds(userIds: readonly string[]): void {
	for (const userId of userIds) {
		assert(
			USER_ID_SHAPE.test(userId),
			`excludedUserIds entries must be 32-character lowercase hex (got: ${userId})`,
		);
	}
}

function absentOrNotInClause(field: string, values: readonly string[]): string[] {
	if (values.length === 0) return [];
	const list = values.map((value) => `"${value}"`).join(", ");
	return [`| filter (not ispresent(${field})) or (${field} not in [${list}])`];
}

export function excludeInternalVisitorsClauses(identities: ExcludedIdentities): string[] {
	return [
		...absentOrNotInClause("visitor_hash", identities.excludedVisitorHashes),
		...absentOrNotInClause("visitor_id", identities.excludedVisitorIds),
		...absentOrNotInClause("user_id", identities.excludedUserIds),
	];
}
