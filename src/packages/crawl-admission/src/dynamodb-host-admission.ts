import assert from "node:assert";
import {
	type ConditionalWriteOutcome,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	writeIfCondition,
} from "@packages/storage-client";
import { z } from "zod";
import type {
	AdmitHost,
	HostAdmissionDeferralReason,
	HostAdmissionOutcome,
	RecordHostCooldown,
	ReleaseHostAdmission,
} from "./host-admission.types";
import { type NormalizedHost, ROUTING_POLICY_VERSION, routingPolicyFor } from "./routing-policy";

export const LEASE_GRACE_AFTER_HARD_DEADLINE_MS = 10_000;
export const CLOCK_UNCERTAINTY_MS = 5_000;
export const LOCAL_WAIT_LIMIT_MS = 2_000;
const ROW_RETENTION_SECONDS = 7 * 24 * 60 * 60;

const HostAdmissionRow = z.object({ pk: z.string() });

const MarshalledEpochMs = z
	.object({ N: z.string() })
	.transform((attribute) => Number(attribute.N))
	.default(0);

const ConditionFailedHostAdmissionRow = z.object({
	ownerToken: z.object({ S: z.string() }).optional(),
	leaseExpiresAt: MarshalledEpochMs,
	nextStartAt: MarshalledEpochMs,
	cooldownUntil: MarshalledEpochMs,
});

export function hostAdmissionKey(host: NormalizedHost): { pk: string } {
	return { pk: `host-admission#${host}` };
}

function retainUntilSeconds(latestMs: number): number {
	return Math.ceil(latestMs / 1_000) + ROW_RETENTION_SECONDS;
}

function deferralFrom(input: {
	oldItem: Record<string, unknown> | undefined;
	nowMs: number;
}): Extract<HostAdmissionOutcome, { kind: "deferred" }> {
	const row = ConditionFailedHostAdmissionRow.parse(input.oldItem);
	const leaseFreeAt =
		row.ownerToken === undefined ? 0 : row.leaseExpiresAt + CLOCK_UNCERTAINTY_MS;
	const gates: { reason: HostAdmissionDeferralReason; at: number }[] = [
		{ reason: "cooldown", at: row.cooldownUntil },
		{ reason: "host-busy", at: leaseFreeAt },
		{ reason: "start-spacing", at: row.nextStartAt },
	];
	const blocking = gates.filter((gate) => gate.at > input.nowMs);
	const [first] = blocking;
	assert(first, "a failed admission condition must leave at least one gate in the future");
	return {
		kind: "deferred",
		reason: first.reason,
		nextEligibleAt: new Date(Math.max(...blocking.map((gate) => gate.at))),
	};
}

export function initDynamoDbHostAdmission(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
	delay: (milliseconds: number) => Promise<void>;
}): {
	admitHost: AdmitHost;
	releaseHostAdmission: ReleaseHostAdmission;
	recordHostCooldown: RecordHostCooldown;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: HostAdmissionRow,
	});

	const tryAdmit: AdmitHost = async ({ host, ownerToken, invocationHardDeadline }) => {
		const nowMs = deps.now().getTime();
		const policy = routingPolicyFor(host);
		const leaseExpiresAt = invocationHardDeadline.getTime() + LEASE_GRACE_AFTER_HARD_DEADLINE_MS;
		const nextStartAt = nowMs + policy.startSpacingMs;
		let outcome: ConditionalWriteOutcome<unknown>;
		try {
			outcome = await writeIfCondition(() =>
				table.update({
					Key: hostAdmissionKey(host),
					UpdateExpression:
						"SET ownerToken = :owner, leaseExpiresAt = :lease, nextStartAt = :next, policyVersion = :version, expiresAt = :expiresAt",
					ConditionExpression:
						"(attribute_not_exists(ownerToken) OR leaseExpiresAt <= :leaseCutoff) AND (attribute_not_exists(nextStartAt) OR nextStartAt <= :now) AND (attribute_not_exists(cooldownUntil) OR cooldownUntil <= :now)",
					ExpressionAttributeValues: {
						":owner": ownerToken,
						":lease": leaseExpiresAt,
						":next": nextStartAt,
						":version": policy.policyVersion,
						":expiresAt": retainUntilSeconds(Math.max(leaseExpiresAt, nextStartAt)),
						":now": nowMs,
						":leaseCutoff": nowMs - CLOCK_UNCERTAINTY_MS,
					},
					ReturnValuesOnConditionCheckFailure: "ALL_OLD",
				}),
			);
		} catch (error) {
			return { kind: "store-unavailable", error };
		}
		if (outcome.kind === "condition-failed") {
			return deferralFrom({ oldItem: outcome.oldItem, nowMs });
		}
		return {
			kind: "admitted",
			lease: { host, ownerToken, leaseExpiresAt: new Date(leaseExpiresAt) },
		};
	};

	const admitHost: AdmitHost = async (request) => {
		const first = await tryAdmit(request);
		if (first.kind !== "deferred") return first;
		const waitMs = first.nextEligibleAt.getTime() - deps.now().getTime();
		if (waitMs > LOCAL_WAIT_LIMIT_MS) return first;
		await deps.delay(waitMs);
		return tryAdmit(request);
	};

	const releaseHostAdmission: ReleaseHostAdmission = async ({ host, ownerToken }) => {
		try {
			const outcome = await writeIfCondition(() =>
				table.update({
					Key: hostAdmissionKey(host),
					UpdateExpression: "REMOVE ownerToken, leaseExpiresAt",
					ConditionExpression: "ownerToken = :owner",
					ExpressionAttributeValues: { ":owner": ownerToken },
				}),
			);
			return outcome.kind === "written" ? { kind: "released" } : { kind: "not-owner" };
		} catch (error) {
			return { kind: "store-unavailable", error };
		}
	};

	const recordHostCooldown: RecordHostCooldown = async ({ host, cooldownUntil }) => {
		const nowMs = deps.now().getTime();
		const cooldownUntilMs = cooldownUntil.getTime();
		try {
			const outcome = await writeIfCondition(() =>
				table.update({
					Key: hostAdmissionKey(host),
					UpdateExpression:
						"SET cooldownUntil = :cooldown, policyVersion = :version, expiresAt = :expiresAt",
					ConditionExpression: "attribute_not_exists(cooldownUntil) OR cooldownUntil < :cooldown",
					ExpressionAttributeValues: {
						":cooldown": cooldownUntilMs,
						":version": ROUTING_POLICY_VERSION,
						":expiresAt": retainUntilSeconds(Math.max(cooldownUntilMs, nowMs)),
					},
				}),
			);
			return outcome.kind === "written" ? { kind: "recorded" } : { kind: "kept-later-cooldown" };
		} catch (error) {
			return { kind: "store-unavailable", error };
		}
	};

	return { admitHost, releaseHostAdmission, recordHostCooldown };
}
