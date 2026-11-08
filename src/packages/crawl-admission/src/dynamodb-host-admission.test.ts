import assert from "node:assert/strict";
import { ConditionalCheckFailedException, type DynamoDBDocumentClient } from "@packages/storage-client";
import { z } from "zod";
import { initDynamoDbHostAdmission } from "./dynamodb-host-admission";
import { HostAdmissionOwnerTokenSchema } from "./host-admission.types";
import { normalizeHostname, ROUTING_POLICY_VERSION } from "./routing-policy";

type SendFn = DynamoDBDocumentClient["send"];

const TABLE = "test-rate-limits";
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;
const T0 = Date.parse("2026-11-08T10:00:00.000Z");

const UpdateInput = z.object({
	TableName: z.string(),
	Key: z.object({ pk: z.string() }),
	UpdateExpression: z.string(),
	ConditionExpression: z.string(),
	ExpressionAttributeValues: z.record(z.string(), z.union([z.string(), z.number()])),
	ReturnValuesOnConditionCheckFailure: z.string().optional(),
});
type UpdateInput = z.infer<typeof UpdateInput>;

function clientFrom(impl: (input: UpdateInput) => unknown): DynamoDBDocumentClient {
	const fake: Partial<DynamoDBDocumentClient> = {
		send: (async (command: { input: unknown }) => impl(UpdateInput.parse(command.input))) as unknown as SendFn,
	};
	return fake as DynamoDBDocumentClient;
}

type MarshalledRow = Record<string, { N: string } | { S: string }>;

function conditionFailed(item?: MarshalledRow): ConditionalCheckFailedException {
	return new ConditionalCheckFailedException({
		message: "The conditional request failed",
		$metadata: {},
		Item: item,
	});
}

function marshalled(row: Record<string, string | number>): MarshalledRow {
	return Object.fromEntries(
		Object.entries(row).map(([name, value]) => [
			name,
			typeof value === "number" ? { N: String(value) } : { S: value },
		]),
	);
}

type Row = Record<string, string | number>;

function sharedTable() {
	const rows = new Map<string, Row>();
	const numberAt = (row: Row, name: string) => {
		const value = row[name];
		return typeof value === "number" ? value : undefined;
	};
	const client = () =>
		clientFrom((input) => {
			const values = input.ExpressionAttributeValues;
			const row = rows.get(input.Key.pk) ?? { pk: input.Key.pk };
			const fail = () => {
				throw conditionFailed(
					input.ReturnValuesOnConditionCheckFailure === "ALL_OLD" && rows.has(input.Key.pk)
						? marshalled(row)
						: undefined,
				);
			};
			if (input.UpdateExpression.startsWith("SET ownerToken")) {
				const now = Number(values[":now"]);
				const lease = numberAt(row, "leaseExpiresAt");
				const next = numberAt(row, "nextStartAt");
				const cooldown = numberAt(row, "cooldownUntil");
				const ownerFree =
					row.ownerToken === undefined || (lease !== undefined && lease <= Number(values[":leaseCutoff"]));
				if (!ownerFree || (next !== undefined && next > now) || (cooldown !== undefined && cooldown > now)) {
					fail();
				}
				rows.set(input.Key.pk, {
					...row,
					ownerToken: values[":owner"],
					leaseExpiresAt: values[":lease"],
					nextStartAt: values[":next"],
					policyVersion: values[":version"],
					expiresAt: values[":expiresAt"],
				});
				return {};
			}
			if (input.UpdateExpression.startsWith("REMOVE")) {
				if (row.ownerToken !== values[":owner"]) fail();
				const { ownerToken: _owner, leaseExpiresAt: _lease, ...rest } = row;
				rows.set(input.Key.pk, rest);
				return {};
			}
			const cooldown = numberAt(row, "cooldownUntil");
			if (cooldown !== undefined && cooldown >= Number(values[":cooldown"])) fail();
			rows.set(input.Key.pk, {
				...row,
				cooldownUntil: values[":cooldown"],
				policyVersion: values[":version"],
				expiresAt: values[":expiresAt"],
			});
			return {};
		});
	return { rows, client };
}

function clock(startMs: number) {
	let nowMs = startMs;
	return {
		now: () => new Date(nowMs),
		advance: (milliseconds: number) => {
			nowMs += milliseconds;
		},
		delay: async (milliseconds: number) => {
			nowMs += milliseconds;
		},
	};
}

const owner = (value: string) => HostAdmissionOwnerTokenSchema.parse(value);
const host = (value: string) => normalizeHostname(value);
const deadlineIn = (time: { now: () => Date }, milliseconds: number) =>
	new Date(time.now().getTime() + milliseconds);

describe("initDynamoDbHostAdmission", () => {
	describe("admitHost", () => {
		it("conditionally sets the owner, a lease ten seconds past the hard deadline and the next start in one update", async () => {
			const received: UpdateInput[] = [];
			const { admitHost } = initDynamoDbHostAdmission({
				client: clientFrom((input) => {
					received.push(input);
					return {};
				}),
				tableName: TABLE,
				now: () => new Date(T0),
				delay: async () => {},
			});

			const outcome = await admitHost({
				host: host("www.coindesk.com"),
				ownerToken: owner("job-1"),
				invocationHardDeadline: new Date(T0 + 420_000),
			});

			assert.deepEqual(outcome, {
				kind: "admitted",
				lease: {
					host: "www.coindesk.com",
					ownerToken: "job-1",
					leaseExpiresAt: new Date(T0 + 430_000),
				},
			});
			assert.equal(received.length, 1);
			const [input] = received;
			assert.ok(input);
			assert.equal(input.TableName, TABLE);
			assert.deepEqual(input.Key, { pk: "host-admission#www.coindesk.com" });
			assert.equal(input.ReturnValuesOnConditionCheckFailure, "ALL_OLD");
			assert.match(input.ConditionExpression, /attribute_not_exists\(ownerToken\) OR leaseExpiresAt <= :leaseCutoff/);
			assert.match(input.ConditionExpression, /nextStartAt <= :now/);
			assert.match(input.ConditionExpression, /cooldownUntil <= :now/);
			assert.deepEqual(input.ExpressionAttributeValues, {
				":owner": "job-1",
				":lease": T0 + 430_000,
				":next": T0 + 10_000,
				":version": ROUTING_POLICY_VERSION,
				":expiresAt": Math.ceil((T0 + 430_000) / 1000) + SEVEN_DAYS_SECONDS,
				":now": T0,
				":leaseCutoff": T0 - 5_000,
			});
		});

		it("spaces an unlisted host two seconds apart", async () => {
			const received: UpdateInput[] = [];
			const { admitHost } = initDynamoDbHostAdmission({
				client: clientFrom((input) => {
					received.push(input);
					return {};
				}),
				tableName: TABLE,
				now: () => new Date(T0),
				delay: async () => {},
			});

			await admitHost({
				host: host("example.com"),
				ownerToken: owner("job-1"),
				invocationHardDeadline: new Date(T0 + 300_000),
			});

			assert.equal(received[0]?.ExpressionAttributeValues[":next"], T0 + 2_000);
		});

		it.each([
			[
				"host-busy",
				{ pk: "p", ownerToken: "other", leaseExpiresAt: T0 + 60_000, nextStartAt: T0 - 1 },
				T0 + 65_000,
			],
			["start-spacing", { pk: "p", nextStartAt: T0 + 9_000 }, T0 + 9_000],
			[
				"cooldown",
				{ pk: "p", ownerToken: "other", leaseExpiresAt: T0 + 60_000, cooldownUntil: T0 + 30_000 },
				T0 + 65_000,
			],
		])("defers as %s until the latest blocking gate", async (reason, row, nextEligibleAt) => {
			let delays = 0;
			const { admitHost } = initDynamoDbHostAdmission({
				client: clientFrom(() => {
					throw conditionFailed(marshalled(row));
				}),
				tableName: TABLE,
				now: () => new Date(T0),
				delay: async () => {
					delays += 1;
				},
			});

			const outcome = await admitHost({
				host: host("example.com"),
				ownerToken: owner("job-1"),
				invocationHardDeadline: new Date(T0 + 300_000),
			});

			assert.deepEqual(outcome, { kind: "deferred", reason, nextEligibleAt: new Date(nextEligibleAt) });
			assert.equal(delays, 0);
		});

		it("waits locally once when the next start is within two seconds, then enters", async () => {
			const time = clock(T0);
			const delays: number[] = [];
			let calls = 0;
			const { admitHost } = initDynamoDbHostAdmission({
				client: clientFrom(() => {
					calls += 1;
					if (calls === 1) throw conditionFailed(marshalled({ pk: "p", nextStartAt: T0 + 2_000 }));
					return {};
				}),
				tableName: TABLE,
				now: time.now,
				delay: async (milliseconds) => {
					delays.push(milliseconds);
					await time.delay(milliseconds);
				},
			});

			const outcome = await admitHost({
				host: host("example.com"),
				ownerToken: owner("job-1"),
				invocationHardDeadline: deadlineIn(time, 300_000),
			});

			assert.equal(outcome.kind, "admitted");
			assert.deepEqual(delays, [2_000]);
		});

		it("returns the second deferral when the host is still not eligible after the local wait", async () => {
			const time = clock(T0);
			const { admitHost } = initDynamoDbHostAdmission({
				client: clientFrom(() => {
					throw conditionFailed(
						marshalled({ pk: "p", nextStartAt: time.now().getTime() + 1_000 }),
					);
				}),
				tableName: TABLE,
				now: time.now,
				delay: time.delay,
			});

			const outcome = await admitHost({
				host: host("example.com"),
				ownerToken: owner("job-1"),
				invocationHardDeadline: deadlineIn(time, 300_000),
			});

			assert.deepEqual(outcome, {
				kind: "deferred",
				reason: "start-spacing",
				nextEligibleAt: new Date(T0 + 2_000),
			});
		});

		it.each([
			["the store throws", () => new Error("ProvisionedThroughputExceededException")],
			["the failed condition returns no row", () => conditionFailed(undefined)],
			["the failed condition leaves no gate in the future", () => conditionFailed(marshalled({ pk: "p" }))],
		])("reports store-unavailable, not contention, when %s", async (_case, failure) => {
			const error = failure();
			const { admitHost } = initDynamoDbHostAdmission({
				client: clientFrom(() => {
					throw error;
				}),
				tableName: TABLE,
				now: () => new Date(T0),
				delay: async () => {},
			});

			const outcome = await admitHost({
				host: host("example.com"),
				ownerToken: owner("job-1"),
				invocationHardDeadline: new Date(T0 + 300_000),
			});

			assert.equal(outcome.kind, "store-unavailable");
		});
	});

	describe("releaseHostAdmission", () => {
		it("removes the lease only when the owner token matches", async () => {
			const received: UpdateInput[] = [];
			const { releaseHostAdmission } = initDynamoDbHostAdmission({
				client: clientFrom((input) => {
					received.push(input);
					return {};
				}),
				tableName: TABLE,
				now: () => new Date(T0),
				delay: async () => {},
			});

			const outcome = await releaseHostAdmission({ host: host("example.com"), ownerToken: owner("job-1") });

			assert.deepEqual(outcome, { kind: "released" });
			assert.deepEqual(received[0]?.Key, { pk: "host-admission#example.com" });
			assert.equal(received[0]?.UpdateExpression, "REMOVE ownerToken, leaseExpiresAt");
			assert.equal(received[0]?.ConditionExpression, "ownerToken = :owner");
			assert.deepEqual(received[0]?.ExpressionAttributeValues, { ":owner": "job-1" });
		});

		it("reports not-owner when another job holds the lease", async () => {
			const { releaseHostAdmission } = initDynamoDbHostAdmission({
				client: clientFrom(() => {
					throw conditionFailed();
				}),
				tableName: TABLE,
				now: () => new Date(T0),
				delay: async () => {},
			});

			const outcome = await releaseHostAdmission({ host: host("example.com"), ownerToken: owner("job-1") });

			assert.deepEqual(outcome, { kind: "not-owner" });
		});

		it("reports store-unavailable when the store throws", async () => {
			const { releaseHostAdmission } = initDynamoDbHostAdmission({
				client: clientFrom(() => {
					throw new Error("network");
				}),
				tableName: TABLE,
				now: () => new Date(T0),
				delay: async () => {},
			});

			const outcome = await releaseHostAdmission({ host: host("example.com"), ownerToken: owner("job-1") });

			assert.equal(outcome.kind, "store-unavailable");
		});
	});

	describe("recordHostCooldown", () => {
		it("writes the cooldown only when it is later than the stored one, retaining the row seven days past it", async () => {
			const received: UpdateInput[] = [];
			const { recordHostCooldown } = initDynamoDbHostAdmission({
				client: clientFrom((input) => {
					received.push(input);
					return {};
				}),
				tableName: TABLE,
				now: () => new Date(T0),
				delay: async () => {},
			});

			const outcome = await recordHostCooldown({
				host: host("example.com"),
				cooldownUntil: new Date(T0 + 600_000),
			});

			assert.deepEqual(outcome, { kind: "recorded" });
			assert.equal(
				received[0]?.ConditionExpression,
				"attribute_not_exists(cooldownUntil) OR cooldownUntil < :cooldown",
			);
			assert.deepEqual(received[0]?.ExpressionAttributeValues, {
				":cooldown": T0 + 600_000,
				":version": ROUTING_POLICY_VERSION,
				":expiresAt": Math.ceil((T0 + 600_000) / 1000) + SEVEN_DAYS_SECONDS,
			});
		});

		it("retains the row seven days past now when the cooldown is already over", async () => {
			const received: UpdateInput[] = [];
			const { recordHostCooldown } = initDynamoDbHostAdmission({
				client: clientFrom((input) => {
					received.push(input);
					return {};
				}),
				tableName: TABLE,
				now: () => new Date(T0),
				delay: async () => {},
			});

			await recordHostCooldown({ host: host("example.com"), cooldownUntil: new Date(T0 - 1_000) });

			assert.equal(received[0]?.ExpressionAttributeValues[":expiresAt"], T0 / 1000 + SEVEN_DAYS_SECONDS);
		});

		it("keeps a later stored cooldown", async () => {
			const { recordHostCooldown } = initDynamoDbHostAdmission({
				client: clientFrom(() => {
					throw conditionFailed();
				}),
				tableName: TABLE,
				now: () => new Date(T0),
				delay: async () => {},
			});

			const outcome = await recordHostCooldown({ host: host("example.com"), cooldownUntil: new Date(T0) });

			assert.deepEqual(outcome, { kind: "kept-later-cooldown" });
		});

		it("reports store-unavailable when the store throws", async () => {
			const { recordHostCooldown } = initDynamoDbHostAdmission({
				client: clientFrom(() => {
					throw new Error("network");
				}),
				tableName: TABLE,
				now: () => new Date(T0),
				delay: async () => {},
			});

			const outcome = await recordHostCooldown({ host: host("example.com"), cooldownUntil: new Date(T0) });

			assert.equal(outcome.kind, "store-unavailable");
		});
	});

	describe("two provider instances sharing one table", () => {
		function twoWorkers() {
			const table = sharedTable();
			const time = clock(T0);
			const worker = () =>
				initDynamoDbHostAdmission({
					client: table.client(),
					tableName: TABLE,
					now: time.now,
					delay: time.delay,
				});
			return { table, time, worker };
		}

		it("lets only one job enter the same host", async () => {
			const { time, worker } = twoWorkers();
			const first = worker();
			const second = worker();

			const a = await first.admitHost({
				host: host("archive.ph"),
				ownerToken: owner("job-a"),
				invocationHardDeadline: deadlineIn(time, 300_000),
			});
			const b = await second.admitHost({
				host: host("archive.ph"),
				ownerToken: owner("job-b"),
				invocationHardDeadline: deadlineIn(time, 300_000),
			});

			assert.equal(a.kind, "admitted");
			assert.deepEqual(b, {
				kind: "deferred",
				reason: "host-busy",
				nextEligibleAt: new Date(T0 + 315_000),
			});
		});

		it("lets jobs for different hosts both enter", async () => {
			const { time, worker } = twoWorkers();

			const a = await worker().admitHost({
				host: host("archive.ph"),
				ownerToken: owner("job-a"),
				invocationHardDeadline: deadlineIn(time, 300_000),
			});
			const b = await worker().admitHost({
				host: host("example.com"),
				ownerToken: owner("job-b"),
				invocationHardDeadline: deadlineIn(time, 300_000),
			});

			assert.equal(a.kind, "admitted");
			assert.equal(b.kind, "admitted");
		});

		it("holds the next job back for the host's start spacing after a release", async () => {
			const { time, worker } = twoWorkers();
			const first = worker();
			await first.admitHost({
				host: host("archive.ph"),
				ownerToken: owner("job-a"),
				invocationHardDeadline: deadlineIn(time, 300_000),
			});
			time.advance(1_000);
			assert.deepEqual(await first.releaseHostAdmission({ host: host("archive.ph"), ownerToken: owner("job-a") }), {
				kind: "released",
			});

			const b = await worker().admitHost({
				host: host("archive.ph"),
				ownerToken: owner("job-b"),
				invocationHardDeadline: deadlineIn(time, 300_000),
			});

			assert.deepEqual(b, { kind: "deferred", reason: "start-spacing", nextEligibleAt: new Date(T0 + 10_000) });
		});

		it("keeps a recorded cooldown for a new instance and keeps the greatest one", async () => {
			const { time, worker } = twoWorkers();
			await worker().recordHostCooldown({ host: host("example.com"), cooldownUntil: new Date(T0 + 600_000) });
			assert.deepEqual(
				await worker().recordHostCooldown({ host: host("example.com"), cooldownUntil: new Date(T0 + 60_000) }),
				{ kind: "kept-later-cooldown" },
			);

			const blocked = await worker().admitHost({
				host: host("example.com"),
				ownerToken: owner("job-b"),
				invocationHardDeadline: deadlineIn(time, 300_000),
			});
			time.advance(600_000);
			const entered = await worker().admitHost({
				host: host("example.com"),
				ownerToken: owner("job-c"),
				invocationHardDeadline: deadlineIn(time, 300_000),
			});

			assert.deepEqual(blocked, { kind: "deferred", reason: "cooldown", nextEligibleAt: new Date(T0 + 600_000) });
			assert.equal(entered.kind, "admitted");
		});

		it("treats a lease as held for five seconds of clock uncertainty past its expiry", async () => {
			const { time, worker } = twoWorkers();
			await worker().admitHost({
				host: host("example.com"),
				ownerToken: owner("job-a"),
				invocationHardDeadline: deadlineIn(time, 300_000),
			});

			time.advance(312_000);
			const early = await worker().admitHost({
				host: host("example.com"),
				ownerToken: owner("job-b"),
				invocationHardDeadline: deadlineIn(time, 300_000),
			});
			time.advance(3_000);
			const onTime = await worker().admitHost({
				host: host("example.com"),
				ownerToken: owner("job-b"),
				invocationHardDeadline: deadlineIn(time, 300_000),
			});

			assert.deepEqual(early, {
				kind: "deferred",
				reason: "host-busy",
				nextEligibleAt: new Date(T0 + 315_000),
			});
			assert.equal(onTime.kind, "admitted");
		});

		it("refuses an expired owner's release of a newer lease", async () => {
			const { table, time, worker } = twoWorkers();
			const stale = worker();
			await stale.admitHost({
				host: host("example.com"),
				ownerToken: owner("job-a"),
				invocationHardDeadline: deadlineIn(time, 300_000),
			});
			time.advance(320_000);
			const replacement = await worker().admitHost({
				host: host("example.com"),
				ownerToken: owner("job-b"),
				invocationHardDeadline: deadlineIn(time, 300_000),
			});

			const release = await stale.releaseHostAdmission({ host: host("example.com"), ownerToken: owner("job-a") });

			assert.equal(replacement.kind, "admitted");
			assert.deepEqual(release, { kind: "not-owner" });
			assert.equal(table.rows.get("host-admission#example.com")?.ownerToken, "job-b");
		});
	});
});
