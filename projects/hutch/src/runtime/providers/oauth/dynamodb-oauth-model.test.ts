import assert from "node:assert/strict";
import { z } from "zod";
import { TransactionCanceledException, type DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { getBuiltInClient } from "@packages/domain/oauth";
import { initDynamoDbOAuthModel } from "./dynamodb-oauth-model";
import { initRefreshProof, refreshContext, type RefreshContext } from "../../oauth-refresh/evidence";

const commandSchema = z.object({
	Key: z.object({ pk: z.string() }).optional(),
	Item: z.record(z.string(), z.unknown()).optional(),
	ExpressionAttributeValues: z.record(z.string(), z.unknown()).optional(),
	UpdateExpression: z.string().optional(),
	TransactItems: z.array(z.object({
		Delete: z.object({ Key: z.object({ pk: z.string() }), ConditionExpression: z.string().optional() }).optional(),
		Update: z.object({ Key: z.object({ pk: z.string() }), UpdateExpression: z.string(), ExpressionAttributeValues: z.record(z.string(), z.unknown()) }).optional(),
	})).optional(),
});

function setup() {
	const controls: {
		beforeSend?: (input: z.infer<typeof commandSchema>) => Promise<void>;
		transactionFailure?: Error;
		queryPageSize?: number;
		afterQuery?: () => void;
	} = {};
	const rows = new Map<string, Record<string, unknown>>();
	const transactions: unknown[] = [];
	const send: DynamoDBDocumentClient["send"] = (async (command: { input: unknown; constructor: { name: string } }) => {
		const input = commandSchema.parse(command.input);
		if (controls.beforeSend) await controls.beforeSend(input);
		function update(pk: string, values: Record<string, unknown>, expression: string) {
			const old = rows.get(pk);
			const row = { ...old, pk };
			if (":grant" in values) Object.assign(row, {
				grantId: expression.includes("if_not_exists(grantId, :grant)") ? old?.grantId ?? values[":grant"] : values[":grant"],
				fingerprint: values[":fingerprint"],
				credentialExpiresAt: expression.includes("if_not_exists(credentialExpiresAt, :expiry)") ? old?.credentialExpiresAt ?? values[":expiry"] : values[":expiry"],
				expiresAt: expression.includes("if_not_exists(expiresAt, :ttl)") ? old?.expiresAt ?? values[":ttl"] : values[":ttl"],
			});
			if (":revocation" in values) Object.assign(row, { revocation: values[":revocation"] });
			rows.set(pk, row);
			return row;
		}
		if (input.TransactItems) {
			transactions.push(command.input);
			if (controls.transactionFailure) throw controls.transactionFailure;
			for (const entry of input.TransactItems) {
				if (entry.Delete?.ConditionExpression && !rows.has(entry.Delete.Key.pk)) throw new TransactionCanceledException({ $metadata: {}, message: "lost race", CancellationReasons: [{ Code: "ConditionalCheckFailed" }] });
			}
			for (const entry of input.TransactItems) {
				if (entry.Delete) rows.delete(entry.Delete.Key.pk);
				if (entry.Update) update(entry.Update.Key.pk, entry.Update.ExpressionAttributeValues, entry.Update.UpdateExpression);
			}
			return {};
		}
		switch (command.constructor.name) {
			case "PutCommand": assert(input.Item); rows.set(String(input.Item.pk), input.Item); return {};
			case "GetCommand": assert(input.Key); return { Item: rows.get(input.Key.pk) };
			case "DeleteCommand": assert(input.Key); rows.delete(input.Key.pk); return {};
			case "UpdateCommand": assert(input.Key); assert(input.ExpressionAttributeValues); assert(input.UpdateExpression); return { Attributes: update(input.Key.pk, input.ExpressionAttributeValues, input.UpdateExpression) };
			case "QueryCommand": {
				const matching = [...rows.values()].filter(row => row.userId === input.ExpressionAttributeValues?.[":userId"]).sort((a, b) => String(a.pk).localeCompare(String(b.pk)));
				const continuation = z.object({ ExclusiveStartKey: z.object({ pk: z.string() }).optional() }).parse(command.input).ExclusiveStartKey;
				const remaining = matching.filter(row => !continuation || String(row.pk) > continuation.pk);
				const page = remaining.slice(0, controls.queryPageSize);
				controls.afterQuery?.();
				return { Items: page, LastEvaluatedKey: page.length < remaining.length ? { pk: page.at(-1)?.pk } : undefined };
			}
			default: throw new Error("Unexpected command");
		}
	}) as DynamoDBDocumentClient["send"];
	const client: Partial<DynamoDBDocumentClient> = { send };
	const model = initDynamoDbOAuthModel({ client: client as DynamoDBDocumentClient, tableName: "oauth", secret: "secret", findUserById: async () => null, findClient: async id => getBuiltInClient(id), markClientActive: async () => {} });
	return { model, rows, transactions, controls };
}

const user = { id: "user", emailVerified: true };
const client = { id: "ios-app", grants: ["authorization_code", "refresh_token"] };
const expiry = new Date("2099-01-01T00:00:00Z");
function token({ access, refresh }: { access: string; refresh: string }) { return { user, client, accessToken: access, refreshToken: refresh, accessTokenExpiresAt: expiry, refreshTokenExpiresAt: expiry }; }
const proof = initRefreshProof("secret");

it("retains one grant through rotation and atomically admits only one competing refresh", async () => {
	const { model, rows, transactions } = setup();
	await model.saveToken(token({ access: "a1", refresh: "r1" }), client, user);
	const first = await model.getRefreshToken("r1");
	const second = await model.getRefreshToken("r1");
	assert(first && second);
	expect(await Promise.all([refreshContext.run({}, () => model.revokeToken(first)), model.revokeToken(second)])).toEqual([true, false]);
	await model.saveToken(token({ access: "a2", refresh: "r2" }), client, first.user);
	const old = rows.get(`credential#${proof.fingerprint("r1")}`);
	const fresh = rows.get(`credential#${proof.fingerprint("r2")}`);
	expect(fresh?.grantId).toBe(old?.grantId);
	expect(fresh?.parentFingerprint).toBe(old?.fingerprint);
	expect(old?.revocation).toMatchObject({ cause: "rotation" });
	expect(old?.expiresAt).toBe(expiry.getTime() / 1000 + 30 * 86400);
	expect(transactions).toHaveLength(2);
	expect(await model.getAccessToken("a1")).toBeNull();
});

it("concurrently adopts legacy credentials into one stable connection", async () => {
	const { model, rows, controls } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	rows.delete(`credential#${proof.fingerprint("r")}`);
	const row = rows.get("token#a"); assert(row); delete row.grantId;
	let waiting = 0;
	let release: () => void = () => {};
	const bothAdopting = new Promise<void>(resolve => { release = resolve; });
	controls.beforeSend = async input => {
		if (input.UpdateExpression) {
			waiting++;
			if (waiting === 2) release();
			await bothAdopting;
		}
	};
	const [a, b] = await Promise.all([model.getRefreshToken("r"), model.getRefreshToken("r")]);
	assert(a && b);
	expect(a.user.grantId).toBe(b.user.grantId);
	expect(typeof a.user.grantId).toBe("string");
});

it.each(["logout", "logout-all", "account-deletion"] as const)("records completed %s revocation", async cause => {
	const { model, rows } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	if (cause === "logout") {
		const refresh = await model.getRefreshToken("r"); assert(refresh);
		await refreshContext.run({ revocationCause: cause }, () => model.revokeToken(refresh));
	} else await model.revokeAllUserOAuthTokens(UserIdSchema.parse(user.id), cause);
	const context: RefreshContext = {};
	await refreshContext.run(context, () => model.getRefreshToken("r"));
	expect(context.reason).toBe(cause);
	expect(context.credential?.revocation?.cause).toBe(cause);
	expect(rows.has("refresh#r")).toBe(false);
});

it("keeps independently authorized connections on the same account distinct", async () => {
	const { model, rows } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	await model.saveToken(token({ access: "b", refresh: "s" }), client, user);
	const first = rows.get(`credential#${proof.fingerprint("r")}`);
	const second = rows.get(`credential#${proof.fingerprint("s")}`);
	expect(new Set([first?.grantId, second?.grantId]).size).toBe(2);
});

it("distinguishes authoritative expiry from unknown deleted legacy credentials", async () => {
	const { model } = setup();
	await model.saveToken({ ...token({ access: "a", refresh: "r" }), refreshTokenExpiresAt: new Date(1000) }, client, user);
	const expired: RefreshContext = {};
	const unknown: RefreshContext = {};
	await refreshContext.run(expired, () => model.getRefreshToken("r"));
	await refreshContext.run(unknown, () => model.getRefreshToken("deleted-legacy"));
	expect(expired.reason).toBe("expired");
	expect(expired.credential?.credentialExpiresAt).toBe(1000);
	expect(unknown.reason).toBe("unknown");
	expect(unknown.credential).toBeUndefined();
});


it("retains original expiry when a credential is adopted or deliberately revoked", async () => {
	const { model, rows } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const original = rows.get(`credential#${proof.fingerprint("r")}`); assert(original);
	const later = rows.get("token#a"); assert(later);
	later.refreshTokenExpiresAt = expiry.getTime() / 1000 + 86400;
	await model.getRefreshToken("r");
	await model.revokeAllUserOAuthTokens(UserIdSchema.parse(user.id), "logout-all");
	const retained = rows.get(`credential#${proof.fingerprint("r")}`);
	expect(retained?.credentialExpiresAt).toBe(original.credentialExpiresAt);
	expect(retained?.expiresAt).toBe(original.expiresAt);
});

it.each([
	new Error("storage unavailable"),
	new TransactionCanceledException({ $metadata: {}, message: "transaction conflict", CancellationReasons: [{ Code: "TransactionConflict" }] }),
	new TransactionCanceledException({ $metadata: {}, message: "unknown cancellation" }),
])("does not record a completed revocation when storage rejects it: %s", async failure => {
	const { model, rows, controls } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const refresh = await model.getRefreshToken("r"); assert(refresh);
	controls.transactionFailure = failure;
	await expect(refreshContext.run({ revocationCause: "logout" }, () => model.revokeToken(refresh))).rejects.toBe(failure);
	expect(rows.get(`credential#${proof.fingerprint("r")}`)?.revocation).toBeUndefined();
	expect(await model.getAccessToken("a")).toMatchObject({ accessToken: "a" });
	await expect(model.revokeAllUserOAuthTokens(UserIdSchema.parse(user.id), "account-deletion")).rejects.toBe(failure);
});

it("does not overwrite a winning revocation with a losing deliberate logout", async () => {
	const { model, rows, controls } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const refresh = await model.getRefreshToken("r"); assert(refresh);
	let waiting = 0;
	let release: () => void = () => {};
	const bothRead = new Promise<void>(resolve => { release = resolve; });
	controls.beforeSend = async input => {
		if (input.TransactItems) {
			waiting++;
			if (waiting === 2) release();
			await bothRead;
		}
	};
	const results = await Promise.all([
		refreshContext.run({ revocationCause: "rotation" }, () => model.revokeToken(refresh)),
		refreshContext.run({ revocationCause: "logout" }, () => model.revokeToken(refresh)),
	]);
	expect(results).toEqual([true, false]);
	expect(rows.get(`credential#${proof.fingerprint("r")}`)?.revocation).toMatchObject({ cause: "rotation" });
});

it("records a completed bulk revocation for a legacy grant and consumes every query page", async () => {
	const { model, rows, controls } = setup();
	for (const id of ["a", "b", "c"]) {
		await model.saveToken(token({ access: id, refresh: `r-${id}` }), client, user);
		const row = rows.get(`token#${id}`); assert(row); delete row.grantId;
		rows.delete(`credential#${proof.fingerprint(`r-${id}`)}`);
	}
	rows.set("code#pending", { pk: "code#pending", userId: user.id });
	rows.set("other#unrelated", { pk: "other#unrelated", userId: user.id });
	controls.queryPageSize = 1;
	await model.revokeAllUserOAuthTokens(UserIdSchema.parse(user.id), "account-deletion");
	for (const id of ["a", "b", "c"]) {
		const context: RefreshContext = {};
		expect(await refreshContext.run(context, () => model.getRefreshToken(`r-${id}`))).toBeNull();
		expect(context.credential?.revocation?.cause).toBe("account-deletion");
	}
	expect(rows.has("code#pending")).toBe(false);
	expect(rows.has("other#unrelated")).toBe(true);
});

it("allows repeated bulk revocation when a stale user-index entry no longer has a token", async () => {
	const { model, rows, controls } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	controls.afterQuery = () => { rows.delete("token#a"); };
	await model.revokeAllUserOAuthTokens(UserIdSchema.parse(user.id), "logout-all");
	expect(rows.get(`credential#${proof.fingerprint("r")}`)?.revocation).toBeUndefined();
});

it("looks up retained evidence when an index remains after its live token disappears", async () => {
	const { model, rows } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	rows.delete("token#a");
	const context: RefreshContext = {};
	expect(await refreshContext.run(context, () => model.getRefreshToken("r"))).toBeNull();
	expect(context.reason).toBe("invalid_grant");
	expect(context.credential?.fingerprint).toBe(proof.fingerprint("r"));
	expect(await model.revokeToken({ refreshToken: "r", user, client, refreshTokenExpiresAt: expiry })).toBe(false);
	expect(await model.revokeToken({ refreshToken: "absent", user, client, refreshTokenExpiresAt: expiry })).toBe(false);
});

it("preserves expiry evidence after the refresh index is deleted", async () => {
	const { model, rows } = setup();
	await model.saveToken({ ...token({ access: "a", refresh: "r" }), refreshTokenExpiresAt: new Date(1000) }, client, user);
	rows.delete("refresh#r");
	const context: RefreshContext = {};
	await refreshContext.run(context, () => model.getRefreshToken("r"));
	expect(context.reason).toBe("expired");
});

it("publishes issuance context only after storing the refresh lookup", async () => {
	const { model } = setup();
	const context: RefreshContext = {};
	await refreshContext.run(context, () => model.saveToken(token({ access: "a", refresh: "r" }), client, user));
	expect(context.credential?.fingerprint).toBe(proof.fingerprint("r"));
	const accessOnly = token({ access: "b", refresh: "" });
	await model.saveToken(accessOnly, client, user);
	expect(await model.getAccessToken("b")).toMatchObject({ accessToken: "b" });
});


it("does not publish successful issuance context when the refresh lookup cannot be stored", async () => {
	const { model, rows, controls } = setup();
	const failure = new Error("index write failed");
	controls.beforeSend = async input => {
		if (input.Item?.pk === "refresh#r") throw failure;
	};
	const context: RefreshContext = {};
	await expect(refreshContext.run(context, () => model.saveToken(token({ access: "a", refresh: "r" }), client, user))).rejects.toBe(failure);
	expect(context.credential).toBeUndefined();
	expect(rows.has("refresh#r")).toBe(false);
});
