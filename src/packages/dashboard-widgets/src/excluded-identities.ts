import type { ExcludedIdentities } from "@packages/provider-contracts/logs-insights";
import type { DeviceClass } from "@packages/web-analytics";
import { z } from "zod";

export type { ExcludedIdentities };

export const EXCLUDED_IDENTITIES_PARAMETER_NAME = "/readplace/excluded-identities";

const BOT_DEVICE_CLASS = "bot" satisfies DeviceClass;

const VISITOR_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const USER_ID_SHAPE = /^[0-9a-f]{32}$/;

const ExcludedIdentitiesSchema = z.object({
	excludedVisitorIds: z.array(z.string().regex(VISITOR_ID_SHAPE)),
	excludedUserIds: z.array(z.string().regex(USER_ID_SHAPE)),
});

export function validateExcludedIdentities(value: unknown): ExcludedIdentities {
	return ExcludedIdentitiesSchema.parse(value);
}

export function parseExcludedIdentities(json: string): ExcludedIdentities {
	return validateExcludedIdentities(JSON.parse(json));
}

function absentOrNotInClause(field: string, values: readonly string[]): string[] {
	if (values.length === 0) return [];
	const list = values.map((value) => `"${value}"`).join(", ");
	return [`| filter (not ispresent(${field})) or (${field} not in [${list}])`];
}

function absentOrNotEqualClause(clause: { field: string; value: DeviceClass }): string {
	return `| filter (not ispresent(${clause.field})) or (${clause.field} != "${clause.value}")`;
}

export function excludeNonAudienceClauses(identities: ExcludedIdentities): string[] {
	return [
		...absentOrNotInClause("visitor_id", identities.excludedVisitorIds),
		...absentOrNotInClause("user_id", identities.excludedUserIds),
		absentOrNotEqualClause({ field: "device_class", value: BOT_DEVICE_CLASS }),
	];
}
