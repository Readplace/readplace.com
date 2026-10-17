import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import OAuthServer from "@node-oauth/oauth2-server";
import { z } from "zod";
import { TransactionCanceledException, type DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { OAuthClientIdSchema, getBuiltInClient } from "@packages/domain/oauth";
import { createViewerIdentityMiddleware } from "@packages/viewer-identity";
import { authDiagnosticContext, type AuthDiagnosticContext } from "../../auth-diagnostics/record";
import { initDynamoDbOAuthModel } from "./dynamodb-oauth-model";
import { initRefreshProof, refreshContext, type RefreshContext } from "../../oauth-refresh/evidence";
import { captureOAuthBody } from "../../oauth-refresh/request-body";
import { initEvaluateRefreshOutcomes, RefreshRefusal } from "../../oauth-refresh/outcomes";
import { initTokenExchange } from "../../web/oauth/token-exchange";
import { initObserveTokenOutcome } from "../../web/oauth/token-refusal";

const commandSchema = z.object({
	Key: z.object({ pk: z.string() }).optional(),
	Item: z.record(z.string(), z.unknown()).optional(),
	ExpressionAttributeValues: z.record(z.string(), z.unknown()).optional(),
	UpdateExpression: z.string().optional(),
	TransactItems: z.array(z.object({
		Put: z.object({ Item: z.record(z.string(), z.unknown()), ConditionExpression: z.string().optional(), ExpressionAttributeValues: z.record(z.string(), z.unknown()).optional() }).optional(),
		ConditionCheck: z.object({ Key: z.object({ pk: z.string() }), ConditionExpression: z.string(), ExpressionAttributeValues: z.record(z.string(), z.unknown()).optional() }).optional(),
		Delete: z.object({ Key: z.object({ pk: z.string() }), ConditionExpression: z.string().optional() }).optional(),
		Update: z.object({ Key: z.object({ pk: z.string() }), UpdateExpression: z.string(), ExpressionAttributeValues: z.record(z.string(), z.unknown()) }).optional(),
	})).optional(),
});

function setup() {
	const controls: {
		beforeSend?: (input: z.infer<typeof commandSchema>) => Promise<void>;
		transactionFailure?: Error;
		activationFailure?: Error;
		queryPageSize?: number;
		afterQuery?: () => void;
	} = {};
	const rows = new Map<string, Record<string, unknown>>();
	const transactions: unknown[] = [];
	const activations: string[] = [];
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
			if (":deletedAt" in values) Object.assign(row, { deletedAt: values[":deletedAt"] });
			if (":one" in values) Object.assign(row, { epoch: Number(old?.epoch ?? 0) + Number(values[":one"]) });
			if (":revoked" in values) Object.assign(row, { state: values[":revoked"] });
			if (":revocation" in values) Object.assign(row, { revocation: values[":revocation"] });
			rows.set(pk, row);
			return row;
		}
		if (input.TransactItems) {
			transactions.push(command.input);
			if (controls.transactionFailure) throw controls.transactionFailure;
			const reasons = input.TransactItems.map(entry => {
				const action = entry.Put ?? entry.ConditionCheck ?? entry.Delete;
				if (!action?.ConditionExpression) return { Code: "None" };
				const pk = "Item" in action ? String(action.Item.pk) : action.Key.pk;
				const row = rows.get(pk);
				const expression = action.ConditionExpression;
				const values = "ExpressionAttributeValues" in action ? action.ExpressionAttributeValues : undefined;
				let accepted = true;
				if (expression === "attribute_exists(pk)") accepted = Boolean(row);
				else if (expression === "attribute_not_exists(pk)") accepted = !row;
				else if (expression.includes("expiresAt <= :now")) accepted = !row || Number(row.expiresAt) <= Number(values?.[":now"]);
				else if (expression.includes("generation = :generation")) accepted = row?.generation === values?.[":generation"] && row?.state === values?.[":state"] && row?.accessToken === values?.[":access"] && row?.epoch === values?.[":epoch"];
				else if (expression.includes("epoch = :epoch")) accepted = (row?.epoch ?? 0) === values?.[":epoch"] && !Object.hasOwn(row ?? {}, "deletedAt");
				else throw new Error(`Unhandled condition: ${expression}`);
				return { Code: accepted ? "None" : "ConditionalCheckFailed" };
			});
			if (reasons.some(reason => reason.Code !== "None")) throw new TransactionCanceledException({ $metadata: {}, message: "lost race", CancellationReasons: reasons });
			for (const entry of input.TransactItems) {
				if (entry.Put) rows.set(String(entry.Put.Item.pk), entry.Put.Item);
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
	const model = initDynamoDbOAuthModel({ enrollmentEnabled: true, client: client as DynamoDBDocumentClient, tableName: "oauth", secret: "secret", findUserById: async () => null, findClient: async id => getBuiltInClient(id), markClientActive: async id => { if (controls.activationFailure) throw controls.activationFailure; activations.push(id); } });
	return { model, rows, transactions, controls, activations };
}

const user = { id: "user", emailVerified: true };
const client = { id: "ios-app", grants: ["authorization_code", "refresh_token"] };
const expiry = new Date("2099-01-01T00:00:00Z");
function token({ access, refresh }: { access: string; refresh: string }) { return { user, client, accessToken: access, refreshToken: refresh, accessTokenExpiresAt: expiry, refreshTokenExpiresAt: expiry }; }
const proof = initRefreshProof("secret");
const chrome = { id: "hutch-chrome-extension", grants: ["authorization_code", "refresh_token"] };
const firefox = { id: "hutch-firefox-extension", grants: ["authorization_code", "refresh_token"] };
const reader = UserIdSchema.parse(user.id);
const iosAppId = OAuthClientIdSchema.parse("ios-app");

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
	expect(transactions).toHaveLength(4);
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

it("getAccessToken returns the grant the token belongs to", async () => {
	const { model } = setup();
	const saved = await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	assert(saved);
	expect(typeof saved.user.grantId).toBe("string");
	const found = await model.getAccessToken("a");
	assert(found);
	expect(found.user.grantId).toBe(saved.user.grantId);
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
		if (input.TransactItems?.some(entry => entry.Put?.Item.pk === "refresh#r")) throw failure;
	};
	const context: RefreshContext = {};
	await expect(refreshContext.run(context, () => model.saveToken(token({ access: "a", refresh: "r" }), client, user))).rejects.toBe(failure);
	expect(context.credential).toBeUndefined();
	expect(rows.has("refresh#r")).toBe(false);
});

it("records a completed disconnect revocation for the disconnected client only", async () => {
	const { model } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	await model.saveToken(token({ access: "c", refresh: "s" }), chrome, user);
	await model.revokeUserOAuthClient({ userId: reader, clientId: iosAppId });
	const context: RefreshContext = {};
	expect(await refreshContext.run(context, () => model.getRefreshToken("r"))).toBeNull();
	expect(context.reason).toBe("disconnect");
	expect(context.credential?.revocation?.cause).toBe("disconnect");
	expect(await model.getAccessToken("c")).toMatchObject({ accessToken: "c" });
});

it("lists each connected client once across every query page", async () => {
	const { model, controls } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	await model.saveToken(token({ access: "b", refresh: "s" }), client, user);
	await model.saveToken(token({ access: "c", refresh: "t" }), chrome, user);
	controls.queryPageSize = 1;
	expect([...await model.listUserOAuthClients(reader)].sort()).toEqual(["hutch-chrome-extension", "ios-app"]);
});

it("lists a client by its live refresh credential and skips one whose credentials have both expired", async () => {
	const { model } = setup();
	await model.saveToken({ ...token({ access: "a", refresh: "r" }), accessTokenExpiresAt: new Date(1000) }, client, user);
	await model.saveToken({ ...token({ access: "c", refresh: "s" }), accessTokenExpiresAt: new Date(1000), refreshTokenExpiresAt: new Date(1000) }, chrome, user);
	expect(await model.listUserOAuthClients(reader)).toEqual(["ios-app"]);
});

it("lists no client for a pending authorization code", async () => {
	const { model, rows } = setup();
	rows.set("code#pending", { pk: "code#pending", userId: user.id, clientId: "hutch-chrome-extension" });
	expect(await model.listUserOAuthClients(reader)).toEqual([]);
});

it("does not list a client whose stale user-index entry no longer has a token", async () => {
	const { model, rows, controls } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	controls.afterQuery = () => { rows.delete("token#a"); };
	expect(await model.listUserOAuthClients(reader)).toEqual([]);
});

it("records no revocation when a disconnect finds a stale user-index entry", async () => {
	const { model, rows, controls, transactions } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	transactions.length = 0;
	controls.afterQuery = () => { rows.delete("token#a"); };
	await model.revokeUserOAuthClient({ userId: reader, clientId: iosAppId });
	expect(transactions).toEqual([]);
	expect(rows.get(`credential#${proof.fingerprint("r")}`)?.revocation).toBeUndefined();
});

it("deletes only the disconnected client's pending codes", async () => {
	const { model, rows } = setup();
	await model.saveToken(token({ access: "f", refresh: "u" }), firefox, user);
	rows.set("code#ios", { pk: "code#ios", userId: user.id, clientId: "ios-app" });
	rows.set("code#chrome", { pk: "code#chrome", userId: user.id, clientId: "hutch-chrome-extension" });
	rows.set("other#unrelated", { pk: "other#unrelated", userId: user.id, clientId: "ios-app" });
	await model.revokeUserOAuthClient({ userId: reader, clientId: iosAppId });
	expect([...rows.keys()].filter(pk => !pk.startsWith("credential#") && !pk.startsWith("refresh#") && !pk.startsWith("grant#")).sort()).toEqual(["code#chrome", "other#unrelated", "token#f"]);
});

it("does not record a disconnect revocation when storage rejects it", async () => {
	const { model, rows, controls } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const failure = new Error("storage unavailable");
	controls.transactionFailure = failure;
	await expect(model.revokeUserOAuthClient({ userId: reader, clientId: iosAppId })).rejects.toBe(failure);
	expect(rows.get(`credential#${proof.fingerprint("r")}`)?.revocation).toBeUndefined();
	expect(await model.getAccessToken("a")).toMatchObject({ accessToken: "a" });
});

it("commits one successor and recovers the same token after a lost response using an atomic proof claim", async () => {
	const { model, rows, transactions } = setup();
	await model.saveToken({ ...token({ access: "a", refresh: "r" }), refreshTokenExpiresAt: new Date(Date.now() + 60_000) }, client, user);
	const now = Date.now();
	const input = { clientId: client.id, refreshToken: "r", now, operationId: "operation", bodyHash: "body", proof: { keyThumbprint: "key", id: "jti", expiresAt: now + 300_000 } };
	const first = await model.refresh.rotate(input); assert(first.ok);
	const recovered = await model.refresh.rotate({ ...input, now: now + 86_400_000, proof: { ...input.proof, id: "fresh", expiresAt: now + 86_700_000 } });
	expect(recovered).toEqual({ ...first, recovered: true });
	expect(rows.has("token#a")).toBe(false);
	expect(rows.get(`credential#${proof.fingerprint("r")}`)?.expiresAt).toBe(Math.ceil(first.credential.refreshExpiresAt / 1000) + 30 * 86400);
	const transaction = commandSchema.parse(transactions[1]);
	expect(transaction.TransactItems?.filter(entry => entry.ConditionCheck)).toHaveLength(1);
	expect(transaction.TransactItems?.filter(entry => entry.Put)).toHaveLength(5);
	expect(await model.refresh.rotate(input)).toMatchObject({ reason: "proof_replayed" });
	expect(await model.getRefreshToken(first.credential.refreshToken)).toBeNull();
});

it("admits one concurrent refresh and lets the identical operation recover its winner", async () => {
	const { model } = setup(); await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const input = { clientId: client.id, refreshToken: "r", now: Date.now(), operationId: "op", bodyHash: "body", proof: { keyThumbprint: "key", id: "jti", expiresAt: Date.now() + 300_000 } };
	const result = await Promise.all([model.refresh.rotate(input), model.refresh.rotate({ ...input, proof: { ...input.proof, id: "other" } })]);
	assert(result[0].ok && result[1].ok);
	expect(result[0].credential).toEqual(result[1].credential);
	expect([result[0].recovered, result[1].recovered].sort()).toEqual([false, true]);
});

it("does not consume any token or proof when the transaction fails", async () => {
	const { model, rows, controls } = setup(); await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	controls.transactionFailure = new Error("unavailable");
	const input = { clientId: client.id, refreshToken: "r", now: Date.now(), operationId: "op", bodyHash: "body", proof: { keyThumbprint: "key", id: "jti", expiresAt: Date.now() + 300_000 } };
	await expect(model.refresh.rotate(input)).rejects.toThrow("unavailable");
	expect(rows.has("token#a")).toBe(true);
	controls.transactionFailure = undefined;
	expect(await model.refresh.rotate(input)).toMatchObject({ ok: true });
});

it("fences a rotation that read its parent before logout-all committed", async () => {
	const { model, controls, rows } = setup(); await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	let injected = false;
	controls.beforeSend = async input => {
		if (input.TransactItems && !injected) {
			injected = true;
			rows.set(`oauth-account#${user.id}`, { pk: `oauth-account#${user.id}`, epoch: 1 });
		}
	};
	expect(await model.refresh.rotate({ clientId: client.id, refreshToken: "r", now: Date.now() })).toMatchObject({ reason: "revoked" });
	expect(await model.getAccessToken("a")).toBeNull();
});

it("fences bound-grant logout and client disconnect against historical result recovery", async () => {
	for (const disconnect of [false, true]) {
		const { model } = setup(); await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
		const input = { clientId: client.id, refreshToken: "r", now: Date.now(), operationId: "op", bodyHash: "body", proof: { keyThumbprint: "key", id: "jti", expiresAt: Date.now() + 300_000 } };
		const first = await model.refresh.rotate(input); assert(first.ok);
		if (disconnect) await model.revokeUserOAuthClient({ userId: reader, clientId: iosAppId });
		else expect(await model.refresh.revoke({ token: "r", now: Date.now(), proof: { ...input.proof, id: "logout" } })).toMatchObject({ ok: true });
		expect(await model.refresh.rotate({ ...input, proof: { ...input.proof, id: "retry" } })).toMatchObject({ reason: "revoked" });
		expect(await model.getAccessToken(first.credential.accessToken)).toBeNull();
	}
});

it("fails closed if a bound grant disappears while its token still exists", async () => {
	const { model, rows } = setup(); await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const first = await model.refresh.rotate({ clientId: client.id, refreshToken: "r", now: Date.now(), operationId: "op", bodyHash: "body", proof: { keyThumbprint: "key", id: "jti", expiresAt: Date.now() + 300_000 } }); assert(first.ok);
	rows.delete(`grant#${first.credential.grantId}`);
	await expect(model.refresh.rotate({ clientId: client.id, refreshToken: first.credential.refreshToken, now: Date.now() })).rejects.toThrow("Bound refresh grant is missing");
	await expect(model.getAccessToken(first.credential.accessToken)).rejects.toThrow("Bound refresh grant is missing");
});

it("renews a client's lifetime before spending its refresh credential and preserves it on renewal failure", async () => {
	const { model, controls, activations, rows } = setup(); await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const input = { clientId: client.id, refreshToken: "r", now: Date.now() };
	controls.activationFailure = new Error("client renewal unavailable");
	await expect(model.refresh.rotate(input)).rejects.toThrow("client renewal unavailable");
	expect(rows.has("token#a")).toBe(true);
	controls.activationFailure = undefined;
	expect(await model.refresh.rotate(input)).toMatchObject({ ok: true });
	expect(activations).toEqual([client.id, client.id]);
});

it("correlates authenticated resources and rejected historical refreshes without logging credentials", async () => {
	const { model } = setup(); await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const context: AuthDiagnosticContext = { request_id: "request", context_id: "context", client: "external", surface: "external" };
	await authDiagnosticContext.run(context, () => model.getAccessToken("a"));
	expect(context).toMatchObject({ client: "ios", surface: "app", subject_ref: expect.stringMatching(/^[a-f0-9]{64}$/), grant_id: expect.any(String) });
	const rotate = { clientId: client.id, refreshToken: "r", now: Date.now() };
	await model.refresh.rotate(rotate);
	const refused: AuthDiagnosticContext = { request_id: "request", context_id: "context", client: "web", surface: "website" };
	expect(await authDiagnosticContext.run(refused, () => model.refresh.rotate(rotate))).toMatchObject({ reason: "superseded" });
	expect(refused.subject_ref).toBe(context.subject_ref);
	expect(refused.grant_id).toBe(context.grant_id);
	expect(refused).toMatchObject({ client: "ios", surface: "app" });
});

it.each([
	["hutch-chrome-extension", "chrome", "background"],
	["hutch-firefox-extension", "firefox", "background"],
	["ios-app", "ios", "app"],
	["android-app", "android", "app"],
	["external-client", "external", "external"],
])("attributes bearer-resource surfaces from the stored client %s", async (id, expectedClient, surface) => {
	const { model } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), { ...client, id }, user);
	const context: AuthDiagnosticContext = { request_id: "request", context_id: "context", client: "web", surface: "website" };
	await authDiagnosticContext.run(context, () => model.getAccessToken("a"));
	expect(context).toMatchObject({ client: expectedClient, surface });
});

it("uses the credential owner for revoke diagnostics even when a different client is claimed", async () => {
	const { model } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const context: AuthDiagnosticContext = { request_id: "request", context_id: "context", client: "chrome", surface: "background" };
	expect(await authDiagnosticContext.run(context, () => model.refresh.revoke({ token: "r", clientId: "hutch-chrome-extension", now: Date.now() }))).toEqual({ ok: true });
	expect(context).toMatchObject({ client: "ios", surface: "app", grant_id: expect.any(String), subject_ref: expect.any(String) });
	expect(await model.getAccessToken("a")).toMatchObject({ accessToken: "a" });
});

it("keeps deletion fenced when an authorization already in progress observes the new account epoch", async () => {
	const { model, rows } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	await model.revokeAllUserOAuthTokens(reader, "account-deletion");
	expect(rows.get(`oauth-account#${user.id}`)).toMatchObject({ epoch: 1, deletedAt: expect.any(Number) });
	await expect(model.saveToken(token({ access: "new", refresh: "new-refresh" }), client, user)).rejects.toBeInstanceOf(TransactionCanceledException);
	expect(rows.has("token#new")).toBe(false);
});

it("attributes expired and epoch-revoked resource credentials before returning an authentication refusal", async () => {
	const { model, rows } = setup();
	await model.saveToken({ ...token({ access: "expired", refresh: "r" }), accessTokenExpiresAt: new Date(1) }, client, user);
	await model.saveToken(token({ access: "active", refresh: "s" }), client, user);
	const expired: AuthDiagnosticContext = { request_id: "request", context_id: "context", client: "external", surface: "external" };
	expect(await authDiagnosticContext.run(expired, () => model.getAccessToken("expired"))).toBeNull();
	expect(expired).toMatchObject({ auth_refusal_reason: "expired", client: "ios", subject_ref: expect.any(String), grant_id: expect.any(String) });
	rows.set(`oauth-account#${user.id}`, { pk: `oauth-account#${user.id}`, epoch: 1 });
	const revoked: AuthDiagnosticContext = { request_id: "request", context_id: "context", client: "external", surface: "external" };
	expect(await authDiagnosticContext.run(revoked, () => model.getAccessToken("active"))).toBeNull();
	expect(revoked).toMatchObject({ auth_refusal_reason: "revoked", client: "ios", subject_ref: expired.subject_ref, grant_id: expect.any(String) });
});

it("atomically migrates legacy rows with no grant, epoch, generation or retained history", async () => {
	const { model, rows } = setup(); await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const row = rows.get("token#a"); assert(row); delete row.grantId; delete row.epoch; delete row.generation;
	rows.delete(`credential#${proof.fingerprint("r")}`);
	expect(await model.getAccessToken("a")).toMatchObject({ accessToken: "a" });
	const context: RefreshContext = {};
	const diagnostics: AuthDiagnosticContext = { request_id: "request", context_id: "context", client: "ios", surface: "app" };
	const result = await authDiagnosticContext.run(diagnostics, () => refreshContext.run(context, () => model.refresh.rotate({ clientId: client.id, refreshToken: "r", now: Date.now() })));
	expect(result).toMatchObject({ ok: true, credential: { generation: 1, epoch: 0 } });
	expect(diagnostics).toMatchObject({ grant_id: expect.any(String), subject_ref: expect.any(String) });
	expect(context.reason).toBe("unknown");
	expect(await model.getAccessToken("a")).toBeNull();
});

it("reports unknown, retained revocation, and a missing cached result through the real store", async () => {
	const { model, rows } = setup();
	const context: RefreshContext = {};
	await refreshContext.run(context, () => model.refresh.rotate({ clientId: client.id, refreshToken: "absent", now: Date.now() }));
	expect(context.reason).toBe("unknown");
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const input = { clientId: client.id, refreshToken: "r", now: Date.now(), operationId: "op", bodyHash: "body", proof: { keyThumbprint: "key", id: "proof", expiresAt: Date.now() + 300_000 } };
	const first = await model.refresh.rotate(input); assert(first.ok);
	rows.delete(`token#${first.credential.accessToken}`);
	await expect(model.refresh.rotate(input)).rejects.toThrow("Refresh result credential is missing");
	await model.refresh.revoke({ token: "r", proof: { ...input.proof, id: "logout" }, now: Date.now() });
	const refusal: RefreshContext = {};
	expect(await refreshContext.run(refusal, () => model.refresh.rotate(input))).toMatchObject({ reason: "revoked" });
	expect(refusal.reason).toBe("rotation");
});

it("keeps the account epoch advanced while allowing newly authorized sessions after ordinary logout-all", async () => {
	const { model } = setup(); await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	await model.revokeAllUserOAuthTokens(reader, "logout-all");
	await model.saveToken(token({ access: "b", refresh: "s" }), client, user);
	expect(await model.refresh.rotate({ clientId: client.id, refreshToken: "s", now: Date.now() })).toMatchObject({ ok: true, credential: { epoch: 1 } });
});

it.each([
	new TransactionCanceledException({ $metadata: {}, message: "throttled", CancellationReasons: [{ Code: "ProvisionedThroughputExceeded" }] }),
	new TransactionCanceledException({ $metadata: {}, message: "unspecified cancellation" }),
])("preserves the parent on non-conditional transaction cancellation: %s", async failure => {
	const { model, rows, controls } = setup(); await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	controls.transactionFailure = failure;
	await expect(model.refresh.rotate({ clientId: client.id, refreshToken: "r", now: Date.now() })).rejects.toBe(failure);
	expect(rows.has("token#a")).toBe(true);
});

it("marks a migrated grant revoked during bulk cleanup and keeps new access-only tokens out of the refresh index", async () => {
	const { model, rows } = setup(); await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const first = await model.refresh.rotate({ clientId: client.id, refreshToken: "r", now: Date.now() }); assert(first.ok);
	await model.revokeAllUserOAuthTokens(reader, "logout-all");
	expect(rows.get(`grant#${first.credential.grantId}`)?.state).toBe("revoked");
	const context: RefreshContext = {};
	await refreshContext.run(context, () => model.saveToken({ ...token({ access: "only-access", refresh: "" }), refreshTokenExpiresAt: new Date(1) }, client, user));
	expect(context.credential).toBeUndefined();
	expect(rows.has("refresh#")).toBe(false);
	expect(rows.get("token#only-access")?.expiresAt).toBe(expiry.getTime() / 1000);
});

it("retries a disconnect that loses to rotation and bounds sustained transaction contention", async () => {
	const { model, controls } = setup(); await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	let commits = 0;
	const conflict = new TransactionCanceledException({ $metadata: {}, message: "conflict", CancellationReasons: [{ Code: "ConditionalCheckFailed" }] });
	controls.beforeSend = async input => { if (input.TransactItems) controls.transactionFailure = ++commits === 1 ? conflict : undefined; };
	await model.revokeUserOAuthClient({ userId: reader, clientId: iosAppId });
	expect(commits).toBe(2);
	await model.saveToken(token({ access: "b", refresh: "s" }), client, user);
	controls.beforeSend = undefined; controls.transactionFailure = conflict;
	await expect(model.revokeUserOAuthClient({ userId: reader, clientId: iosAppId })).rejects.toThrow("Concurrent disconnect could not settle");
});

it("settles a disconnect when the account epoch already invalidated its token", async () => {
	const { model, rows, transactions } = setup(); await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	rows.set(`oauth-account#${user.id}`, { pk: `oauth-account#${user.id}`, epoch: 1 });
	transactions.length = 0;
	await model.revokeUserOAuthClient({ userId: reader, clientId: iosAppId });
	expect(transactions).toEqual([]);
});

it("settles a disconnect whose credential disappears after the user-index lookup", async () => {
	for (const keepHistory of [false, true]) {
		const { model, rows, controls } = setup(); await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
		controls.beforeSend = async input => {
			if (input.Key?.pk === "refresh#r") {
				rows.delete("token#a");
				if (!keepHistory) rows.delete(`credential#${proof.fingerprint("r")}`);
			}
		};
		await model.revokeUserOAuthClient({ userId: reader, clientId: iosAppId });
		expect(rows.has("token#a")).toBe(false);
	}
});

function tokenEndpoint(model: ReturnType<typeof setup>["model"]) {
	const recorded: unknown[] = [];
	const now = () => new Date();
	const app = express().use(createViewerIdentityMiddleware({ edgeSecret: "" }), express.urlencoded({ extended: false, verify: captureOAuthBody }));
	app.post("/oauth/token",
		initObserveTokenOutcome({ recordUngatedAnalyticsEvent: event => { recorded.push(event); }, now, salt: "secret" }),
		initTokenExchange({ model, server: new OAuthServer({ model, requireClientAuthentication: { authorization_code: false, refresh_token: false } }),
			findClient: async id => getBuiltInClient(id), baseUrl: "https://readplace.com", salt: "secret", now }));
	const refreshAs = (input: { clientId: string; refreshToken: string }) => request(app).post("/oauth/token").type("form").send({ grant_type: "refresh_token", client_id: input.clientId, refresh_token: input.refreshToken });
	return {
		refresh: (refreshToken: string) => refreshAs({ clientId: client.id, refreshToken }),
		refreshAs,
		lastRefusal: () => z.object({ refresh_refusal: RefreshRefusal }).parse(recorded.at(-1)).refresh_refusal,
	};
}

async function evaluateAfterPendingWindow(refusal: RefreshRefusal) {
	const evaluate = initEvaluateRefreshOutcomes({ readDay: async () => [{ day: "day", order: "order", expiresAt: 0, refusal }], testGrants: [], publish: async () => {} });
	return evaluate(refusal.occurredAt + 360_000);
}

it.each([
	["disconnect", (model: ReturnType<typeof setup>["model"]) => model.revokeUserOAuthClient({ userId: reader, clientId: iosAppId })],
	["logout-all", (model: ReturnType<typeof setup>["model"]) => model.revokeAllUserOAuthTokens(reader, "logout-all")],
	["logout", (model: ReturnType<typeof setup>["model"]) => model.refresh.revoke({ token: "r", now: Date.now() })],
	["account-deletion", (model: ReturnType<typeof setup>["model"]) => model.revokeAllUserOAuthTokens(reader, "account-deletion")],
] as const)("records a refresh refused after a %s revocation under its cause, which the evaluator counts expected, while the app still reads revoked", async (cause, revoke) => {
	const { model } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	await revoke(model);
	const endpoint = tokenEndpoint(model);
	const response = await endpoint.refresh("r");
	expect(response.status).toBe(400);
	expect(response.body).toEqual({ error: "invalid_grant", readplace_reason: "revoked" });
	const refusal = endpoint.lastRefusal();
	expect(refusal).toMatchObject({ reason: cause, revocation: { cause } });
	expect(await evaluateAfterPendingWindow(refusal)).toMatchObject({ raw: 1, expected: 1, unexpected: 0 });
});

it("records a reused rotated refresh token under rotation, which the evaluator counts unexpected past the pending window", async () => {
	const { model } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const endpoint = tokenEndpoint(model);
	expect((await endpoint.refresh("r")).status).toBe(200);
	const response = await endpoint.refresh("r");
	expect(response.body).toEqual({ error: "invalid_grant", readplace_reason: "superseded" });
	const refusal = endpoint.lastRefusal();
	expect(refusal).toMatchObject({ reason: "rotation", revocation: { cause: "rotation" } });
	expect(await evaluateAfterPendingWindow(refusal)).toMatchObject({ raw: 1, expected: 0, unexpected: 1 });
});

it("records a refresh another client presented for a token that logout-all revoked under unknown, not the revocation's cause, which the evaluator counts unexpected", async () => {
	const { model } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const endpoint = tokenEndpoint(model);
	const rotated = z.object({ refresh_token: z.string() }).parse((await endpoint.refresh("r")).body);
	await model.revokeAllUserOAuthTokens(reader, "logout-all");
	const response = await endpoint.refreshAs({ clientId: chrome.id, refreshToken: rotated.refresh_token });
	expect(response.status).toBe(400);
	expect(response.body).toEqual({ error: "invalid_grant", readplace_reason: "unknown" });
	const refusal = endpoint.lastRefusal();
	expect(refusal).toMatchObject({ reason: "unknown", revocation: { cause: "logout-all" } });
	expect(await evaluateAfterPendingWindow(refusal)).toMatchObject({ raw: 1, expected: 0, unexpected: 1 });
});

it("records a bound grant's refresh that arrived without its proof after logout-all under proof_required, not the revocation's cause, which the evaluator counts unexpected", async () => {
	const { model } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const bound = await model.refresh.rotate({ clientId: client.id, refreshToken: "r", now: Date.now(), operationId: "op", bodyHash: "body", proof: { keyThumbprint: "key", id: "jti", expiresAt: Date.now() + 300_000 } });
	assert(bound.ok);
	await model.revokeAllUserOAuthTokens(reader, "logout-all");
	const endpoint = tokenEndpoint(model);
	const response = await endpoint.refresh(bound.credential.refreshToken);
	expect(response.status).toBe(400);
	expect(response.body).toEqual({ error: "invalid_dpop_proof", readplace_reason: "proof_required" });
	const refusal = endpoint.lastRefusal();
	expect(refusal).toMatchObject({ reason: "proof_required", revocation: { cause: "logout-all" } });
	expect(await evaluateAfterPendingWindow(refusal)).toMatchObject({ raw: 1, expected: 0, unexpected: 1 });
});
