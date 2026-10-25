import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import OAuthServer from "@node-oauth/oauth2-server";
import { z } from "zod";
import { TransactionCanceledException, type DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { OAuthClientIdSchema, type OAuthGrantId, OAuthGrantIdSchema, type RefreshCredential, getBuiltInClient } from "@packages/domain/oauth";
import { createViewerIdentityMiddleware } from "@packages/viewer-identity";
import { authDiagnosticContext, type AuthDiagnosticContext } from "../../auth-diagnostics/record";
import { initDynamoDbOAuthModel } from "./dynamodb-oauth-model";
import { initDynamoRefreshStore } from "./dynamodb-refresh-store";
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
		Update: z.object({ Key: z.object({ pk: z.string() }), UpdateExpression: z.string(), ConditionExpression: z.string().optional(), ExpressionAttributeValues: z.record(z.string(), z.unknown()) }).optional(),
	})).optional(),
});

function setup() {
	const controls: {
		beforeSend?: (input: z.infer<typeof commandSchema>) => Promise<void>;
		transactionFailure?: Error;
		activationFailure?: Error;
		queryPageSize?: number;
		afterQuery?: () => void;
		unindexed?: Set<string>;
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
			if (":next" in values) Object.assign(row, { epoch: values[":next"] });
			if (":exemption" in values) Object.assign(row, { exemption: values[":exemption"] });
			rows.set(pk, row);
			return row;
		}
		if (input.TransactItems) {
			transactions.push(command.input);
			if (controls.transactionFailure) throw controls.transactionFailure;
			const reasons = input.TransactItems.map(entry => {
				const action = entry.Put ?? entry.ConditionCheck ?? entry.Delete ?? entry.Update;
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
				const matching = [...rows.values()].filter(row => row.userId === input.ExpressionAttributeValues?.[":userId"] && !controls.unindexed?.has(String(row.pk))).sort((a, b) => String(a.pk).localeCompare(String(b.pk)));
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
	const documentClient = client as DynamoDBDocumentClient;
	const model = initDynamoDbOAuthModel({ enrollmentEnabled: true, client: documentClient, tableName: "oauth", secret: "secret", findUserById: async () => null, findClient: async id => getBuiltInClient(id), markClientActive: async id => { if (controls.activationFailure) throw controls.activationFailure; activations.push(id); } });
	const store = initDynamoRefreshStore({ client: documentClient, tableName: "oauth", secret: "secret" });
	return { model, rows, transactions, controls, activations, store };
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

it("carries the grant and the parent's fingerprint into the rotated credential and records the parent's rotation", async () => {
	const { model, rows } = setup();
	await model.saveToken(token({ access: "a1", refresh: "r1" }), client, user);
	const child = await model.refresh.rotate({ clientId: client.id, refreshToken: "r1", now: Date.now() });
	assert(child.ok);
	const old = rows.get(`credential#${proof.fingerprint("r1")}`);
	const fresh = rows.get(`credential#${proof.fingerprint(child.credential.refreshToken)}`);
	expect(fresh?.grantId).toBe(old?.grantId);
	expect(fresh?.parentFingerprint).toBe(old?.fingerprint);
	expect(old?.revocation).toMatchObject({ cause: "rotation" });
	expect(await model.getAccessToken("a1")).toBeNull();
});

it("concurrently adopts legacy credentials into one stable connection", async () => {
	const { model, rows, controls, store } = setup();
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
	const [a, b] = await Promise.all([store.store.locate("r"), store.store.locate("r")]);
	expect(a.credential?.grantId).toBe(b.credential?.grantId);
	expect(typeof a.credential?.grantId).toBe("string");
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

it("issues a token under the grant its authorization code was minted for", async () => {
	const { model, rows } = setup();
	await model.saveAuthorizationCode(authorizationCode("code"), client, user);
	const code = await model.getAuthorizationCode("code"); assert(code);
	const saved = await model.saveToken(token({ access: "a", refresh: "r" }), client, code.user); assert(saved);
	expect(saved.user.grantId).toBe(code.user.grantId);
	expect(rows.get(`credential#${proof.fingerprint("r")}`)?.grantId).toBe(code.user.grantId);
});

it("keeps independently authorized connections on the same account distinct", async () => {
	const { model, rows } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	await model.saveToken(token({ access: "b", refresh: "s" }), client, user);
	const first = rows.get(`credential#${proof.fingerprint("r")}`);
	const second = rows.get(`credential#${proof.fingerprint("s")}`);
	expect(new Set([first?.grantId, second?.grantId]).size).toBe(2);
});

it("reports an expired credential and its original expiry through the real store", async () => {
	const { model } = setup();
	await model.saveToken({ ...token({ access: "a", refresh: "r" }), refreshTokenExpiresAt: new Date(1000) }, client, user);
	const context: RefreshContext = {};
	expect(await refreshContext.run(context, () => model.refresh.rotate({ clientId: client.id, refreshToken: "r", now: Date.now() }))).toMatchObject({ reason: "expired" });
	expect(context.credential?.credentialExpiresAt).toBe(1000);
});


it("retains original expiry when a credential is deliberately revoked", async () => {
	const { model, rows } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const original = rows.get(`credential#${proof.fingerprint("r")}`); assert(original);
	const later = rows.get("token#a"); assert(later);
	later.refreshTokenExpiresAt = expiry.getTime() / 1000 + 86400;
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
	controls.transactionFailure = failure;
	await expect(model.revokeAllUserOAuthTokens(UserIdSchema.parse(user.id), "account-deletion")).rejects.toBe(failure);
	expect(rows.get(`credential#${proof.fingerprint("r")}`)?.revocation).toBeUndefined();
	expect(rows.has("token#a")).toBe(true);
});

it("records no revocation when a bulk revocation's token row disappears before its transaction", async () => {
	const { model, rows, controls } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	controls.beforeSend = async input => { if (input.TransactItems) rows.delete("token#a"); };
	await model.revokeAllUserOAuthTokens(reader, "logout-all");
	expect(rows.get(`credential#${proof.fingerprint("r")}`)?.revocation).toBeUndefined();
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
		expect(await refreshContext.run(context, () => model.refresh.rotate({ clientId: client.id, refreshToken: `r-${id}`, now: Date.now() }))).toMatchObject({ reason: "revoked" });
		expect(context.credential?.revocation?.cause).toBe("account-deletion");
		expect(rows.has(`refresh#r-${id}`)).toBe(false);
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
	expect(await refreshContext.run(context, () => model.refresh.rotate({ clientId: client.id, refreshToken: "r", now: Date.now() }))).toMatchObject({ reason: "unknown" });
	expect(context.credential?.fingerprint).toBe(proof.fingerprint("r"));
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
	expect(await refreshContext.run(context, () => model.refresh.rotate({ clientId: client.id, refreshToken: "r", now: Date.now() }))).toMatchObject({ reason: "revoked" });
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
	expect([...await model.listUserOAuthClients(reader)].map(listed => listed.clientId).sort()).toEqual(["hutch-chrome-extension", "ios-app"]);
});

it("lists a client by its live refresh credential and skips one whose credentials have both expired", async () => {
	const { model } = setup();
	await model.saveToken({ ...token({ access: "a", refresh: "r" }), accessTokenExpiresAt: new Date(1000) }, client, user);
	await model.saveToken({ ...token({ access: "c", refresh: "s" }), accessTokenExpiresAt: new Date(1000), refreshTokenExpiresAt: new Date(1000) }, chrome, user);
	expect(await model.listUserOAuthClients(reader)).toEqual([{ clientId: "ios-app", latestSignIn: undefined }]);
});

it("reports each client's latest sign-in across its live tokens", async () => {
	const { model } = setup();
	const fromSydney = { at: 2_000, location: { city: "Sydney", country: "AU" }, device: { browser: "safari", os: "ios" } };
	await model.saveToken(token({ access: "a", refresh: "r" }), client, { ...user, signedIn: { at: 1_000 } });
	await model.saveToken(token({ access: "b", refresh: "s" }), client, { ...user, signedIn: fromSydney });
	await model.saveToken(token({ access: "c", refresh: "t" }), client, user);
	await model.saveToken(token({ access: "d", refresh: "u" }), chrome, user);
	expect(await model.listUserOAuthClients(reader)).toEqual([
		{ clientId: "ios-app", latestSignIn: fromSydney },
		{ clientId: "hutch-chrome-extension", latestSignIn: undefined },
	]);
});

it("carries the sign-in from the authorization code row to the token row and on to the rotated child's row", async () => {
	const { model, rows } = setup();
	const signedIn = { at: 1_000, location: { country: "AU" }, device: { browser: "chrome", os: "android" } };
	await model.saveAuthorizationCode({ authorizationCode: "code", expiresAt: expiry, redirectUri: "readplace://oauth-callback", codeChallenge: "challenge" }, client, { ...user, signedIn });
	const code = await model.getAuthorizationCode("code");
	assert(code);
	await model.saveToken(token({ access: "a", refresh: "r" }), client, code.user);
	const parentRow = rows.get("token#a");
	const child = await model.refresh.rotate({ clientId: client.id, refreshToken: "r", now: Date.now() });
	assert(child.ok);
	expect([rows.get("code#code")?.signedIn, code.user.signedIn, parentRow?.signedIn, rows.get(`token#${child.credential.accessToken}`)?.signedIn]).toEqual([signedIn, signedIn, signedIn, signedIn]);
	expect(await model.listUserOAuthClients(reader)).toEqual([{ clientId: "ios-app", latestSignIn: signedIn }]);
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

it("settles a disconnect of a rotated grant when the account epoch already invalidated it", async () => {
	const { model, rows, transactions } = setup();
	const kept = await model.saveToken(token({ access: "a", refresh: "r" }), client, user); assert(kept);
	const first = await model.refresh.rotate({ clientId: client.id, refreshToken: "r", now: Date.now() }); assert(first.ok);
	rows.set(`oauth-account#${user.id}`, { pk: `oauth-account#${user.id}`, epoch: 1 });
	transactions.length = 0;
	await model.revokeUserOAuthClient({ userId: reader, clientId: iosAppId });
	expect(transactions).toEqual([]);
	expect(rows.get(`grant#${kept.user.grantId}`)).toMatchObject({ state: "active", epoch: 0, generation: 1 });
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

it("validates an exempt access token and refuses the other grants at the old epoch", async () => {
	const { model, rows } = setup();
	const kept = await model.saveToken(token({ access: "a", refresh: "r" }), client, user); assert(kept);
	await model.saveToken(token({ access: "b", refresh: "s" }), chrome, user);
	rows.set(`oauth-account#${user.id}`, { pk: `oauth-account#${user.id}`, epoch: 1, exemption: { atEpoch: 1, grantId: kept.user.grantId, grantEpoch: 0 } });
	expect(await model.getAccessToken("a")).toMatchObject({ accessToken: "a" });
	expect(await model.getAccessToken("b")).toBeNull();
	expect(await model.refresh.rotate({ clientId: chrome.id, refreshToken: "s", now: Date.now() })).toMatchObject({ reason: "revoked" });
});

it("keeps nothing for a stranded exemption", async () => {
	const { model, rows } = setup();
	const kept = await model.saveToken(token({ access: "a", refresh: "r" }), client, user); assert(kept);
	rows.set(`oauth-account#${user.id}`, { pk: `oauth-account#${user.id}`, epoch: 2, exemption: { atEpoch: 1, grantId: kept.user.grantId, grantEpoch: 0 } });
	expect(await model.getAccessToken("a")).toBeNull();
	expect(await model.refresh.rotate({ clientId: client.id, refreshToken: "r", now: Date.now() })).toMatchObject({ reason: "revoked" });
});

it("issues a usable child when a rotation read its credential before the change and its grant after it", async () => {
	const { model, rows, controls } = setup();
	const kept = await model.saveToken(token({ access: "a", refresh: "r" }), client, user); assert(kept);
	controls.beforeSend = async input => {
		if (input.Key?.pk.startsWith("grant#")) {
			controls.beforeSend = undefined;
			rows.set(`oauth-account#${user.id}`, { pk: `oauth-account#${user.id}`, epoch: 1, exemption: { atEpoch: 1, grantId: kept.user.grantId, grantEpoch: 0 } });
		}
	};
	const first = await model.refresh.rotate({ clientId: client.id, refreshToken: "r", now: Date.now() });
	expect(first).toMatchObject({ ok: true, credential: { epoch: 1, generation: 1 } });
	assert(first.ok);
	expect(await model.getAccessToken(first.credential.accessToken)).toMatchObject({ accessToken: first.credential.accessToken });
	expect(await model.refresh.rotate({ clientId: client.id, refreshToken: first.credential.refreshToken, now: Date.now() })).toMatchObject({ ok: true, credential: { epoch: 1, generation: 2 } });
	expect(rows.get(`grant#${kept.user.grantId}`)).toMatchObject({ epoch: 1, generation: 2, state: "active" });
});

it.each([
	["logout", (model: ReturnType<typeof setup>["model"]) => model.refresh.revoke({ token: "r", now: Date.now() })],
	["disconnect", (model: ReturnType<typeof setup>["model"]) => model.revokeUserOAuthClient({ userId: reader, clientId: iosAppId })],
] as const)("%s revokes an exempt grant", async (cause, revoke) => {
	const { model, rows } = setup();
	const kept = await model.saveToken(token({ access: "a", refresh: "r" }), client, user); assert(kept);
	rows.set(`oauth-account#${user.id}`, { pk: `oauth-account#${user.id}`, epoch: 1, exemption: { atEpoch: 1, grantId: kept.user.grantId, grantEpoch: 0 } });
	await revoke(model);
	expect(rows.get(`grant#${kept.user.grantId}`)).toMatchObject({ state: "revoked", epoch: 0 });
	expect(await model.getAccessToken("a")).toBeNull();
	const context: RefreshContext = {};
	expect(await refreshContext.run(context, () => model.refresh.rotate({ clientId: client.id, refreshToken: "r", now: Date.now() }))).toMatchObject({ reason: "revoked" });
	expect(context.reason).toBe(cause);
});

it("disconnect revokes the kept grant when its rotation and a second keep land inside the disconnect's reads", async () => {
	const { model, rows, controls } = setup();
	const kept = await model.saveToken(token({ access: "a", refresh: "r" }), client, user); assert(kept);
	const first = await model.refresh.rotate({ clientId: client.id, refreshToken: "r", now: Date.now() }); assert(first.ok);
	rows.set(`oauth-account#${user.id}`, { pk: `oauth-account#${user.id}`, epoch: 1, exemption: { atEpoch: 1, grantId: kept.user.grantId, grantEpoch: 0 } });
	let rotated: RefreshCredential | undefined;
	controls.beforeSend = async input => {
		if (input.Key?.pk !== `oauth-account#${user.id}`) return;
		controls.beforeSend = undefined;
		const second = await model.refresh.rotate({ clientId: client.id, refreshToken: first.credential.refreshToken, now: Date.now() }); assert(second.ok);
		rotated = second.credential;
		rows.set(`oauth-account#${user.id}`, { pk: `oauth-account#${user.id}`, epoch: 2, exemption: { atEpoch: 2, grantId: kept.user.grantId, grantEpoch: 1 } });
	};
	await model.revokeUserOAuthClient({ userId: reader, clientId: iosAppId });
	assert(rotated);
	const child = rotated;
	expect(rows.get(`grant#${kept.user.grantId}`)).toMatchObject({ state: "revoked", epoch: 1, generation: 2 });
	expect(await model.getAccessToken(child.accessToken)).toBeNull();
	expect(await model.listUserOAuthClients(reader)).toEqual([]);
	const context: RefreshContext = {};
	expect(await refreshContext.run(context, () => model.refresh.rotate({ clientId: client.id, refreshToken: child.refreshToken, now: Date.now() }))).toMatchObject({ reason: "revoked" });
	expect(context.reason).toBe("disconnect");
});

function fireOnCredentialReadAfterGrantRead(controls: ReturnType<typeof setup>["controls"], accessToken: string, then: () => Promise<void>) {
	let previous = "";
	controls.beforeSend = async input => {
		const pk = input.Key?.pk ?? "";
		const credentialReadAfterGrantRead = pk === `token#${accessToken}` && previous.startsWith("grant#");
		previous = pk;
		if (!credentialReadAfterGrantRead) return;
		controls.beforeSend = undefined;
		await then();
	};
}

it("disconnect revokes a grant whose rotation lands between its grant and credential reads", async () => {
	const { model, rows, controls } = setup();
	const kept = await model.saveToken(token({ access: "a", refresh: "r" }), client, user); assert(kept);
	const first = await model.refresh.rotate({ clientId: client.id, refreshToken: "r", now: Date.now() }); assert(first.ok);
	let rotated: RefreshCredential | undefined;
	fireOnCredentialReadAfterGrantRead(controls, first.credential.accessToken, async () => {
		const second = await model.refresh.rotate({ clientId: client.id, refreshToken: first.credential.refreshToken, now: Date.now() }); assert(second.ok);
		rotated = second.credential;
	});
	await model.revokeUserOAuthClient({ userId: reader, clientId: iosAppId });
	assert(rotated);
	const child = rotated;
	expect(rows.get(`grant#${kept.user.grantId}`)).toMatchObject({ state: "revoked", epoch: 0, generation: 2 });
	expect(await model.getAccessToken(child.accessToken)).toBeNull();
	expect(await model.listUserOAuthClients(reader)).toEqual([]);
	const context: RefreshContext = {};
	expect(await refreshContext.run(context, () => model.refresh.rotate({ clientId: client.id, refreshToken: child.refreshToken, now: Date.now() }))).toMatchObject({ reason: "revoked" });
	expect(context.reason).toBe("disconnect");
});

it("revokes a grant whose token row vanished without a rotation inside the disconnect's reads", async () => {
	const { model, rows, controls, transactions } = setup();
	const kept = await model.saveToken(token({ access: "a", refresh: "r" }), client, user); assert(kept);
	const first = await model.refresh.rotate({ clientId: client.id, refreshToken: "r", now: Date.now() }); assert(first.ok);
	fireOnCredentialReadAfterGrantRead(controls, first.credential.accessToken, async () => {
		rows.delete(`token#${first.credential.accessToken}`);
		rows.delete(`refresh#${first.credential.refreshToken}`);
	});
	transactions.length = 0;
	await model.revokeUserOAuthClient({ userId: reader, clientId: iosAppId });
	expect(transactions).toHaveLength(1);
	expect(rows.get(`grant#${kept.user.grantId}`)).toMatchObject({ state: "revoked", epoch: 0, generation: 1 });
	expect(await model.listUserOAuthClients(reader)).toEqual([]);
});

it("refuses a token whose generation is behind its active grant row", async () => {
	const { model, rows } = setup();
	const kept = await model.saveToken(token({ access: "a", refresh: "r" }), client, user); assert(kept);
	rows.set(`grant#${kept.user.grantId}`, { pk: `grant#${kept.user.grantId}`, id: kept.user.grantId, userId: user.id, clientId: client.id, epoch: 0, generation: 1, accessToken: "a", refreshFingerprint: "x", state: "active", expiresAt: 4102444800, validUntil: 4102444800000 });
	expect(await model.getAccessToken("a")).toBeNull();
});

type Model = ReturnType<typeof setup>["model"];

function boundRotation(input: { clientId: string; refreshToken: string; operationId?: string }) {
	return { clientId: input.clientId, refreshToken: input.refreshToken, now: Date.now(), operationId: input.operationId ?? randomUUID(), bodyHash: "body", proof: { keyThumbprint: "key", id: randomUUID(), expiresAt: Date.now() + 300_000 } };
}

async function rotateBound(model: Model, input: { clientId: string; refreshToken: string; operationId?: string }): Promise<RefreshCredential> {
	const result = await model.refresh.rotate(boundRotation(input));
	assert(result.ok, `the bound rotation must succeed: ${JSON.stringify(result)}`);
	return result.credential;
}

const grantIdOf = (credential: RefreshCredential): OAuthGrantId => OAuthGrantIdSchema.parse(credential.grantId);
const accountRow = `oauth-account#${user.id}`;

function authorizationCode(code: string) {
	return { authorizationCode: code, expiresAt: expiry, redirectUri: "readplace://oauth-callback", codeChallenge: "challenge", codeChallengeMethod: "S256", client, user };
}

it("keeps the named grant and disconnects every other grant and code", async () => {
	const { model, rows } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const kept = await rotateBound(model, { clientId: client.id, refreshToken: "r" });
	await model.saveToken(token({ access: "b", refresh: "s" }), chrome, user);
	await model.saveAuthorizationCode(authorizationCode("before"), client, user);

	expect(await model.revokeOtherUserOAuthGrants({ userId: reader, keep: grantIdOf(kept) })).toEqual({ kept: kept.grantId });

	expect(rows.get(accountRow)).toEqual({ pk: accountRow, epoch: 1, exemption: { atEpoch: 1, grantId: kept.grantId, grantEpoch: 0 } });
	expect(await model.getAccessToken(kept.accessToken)).toMatchObject({ accessToken: kept.accessToken });
	expect(await model.getAccessToken("b")).toBeNull();
	expect(rows.get(`credential#${proof.fingerprint(kept.refreshToken)}`)).toEqual(expect.not.objectContaining({ revocation: expect.anything() }));
	expect(rows.get(`credential#${proof.fingerprint("s")}`)).toMatchObject({ revocation: { cause: "logout-all" } });
	const endpoint = tokenEndpoint(model);
	expect((await endpoint.refreshAs({ clientId: chrome.id, refreshToken: "s" })).body).toEqual({ error: "invalid_grant", readplace_reason: "revoked" });
	const refusal = endpoint.lastRefusal();
	expect(refusal).toMatchObject({ reason: "logout-all", revocation: { cause: "logout-all" } });
	expect(await evaluateAfterPendingWindow(refusal)).toMatchObject({ raw: 1, expected: 1, unexpected: 0 });
	expect(await model.getAuthorizationCode("before")).toBeNull();
	await model.saveAuthorizationCode(authorizationCode("after"), client, user);
	expect(await model.getAuthorizationCode("after")).toMatchObject({ authorizationCode: "after" });
	const rotated = await rotateBound(model, { clientId: client.id, refreshToken: kept.refreshToken });
	expect(rotated).toMatchObject({ epoch: 1, generation: 2, keyThumbprint: "key" });
	expect(rows.get(`grant#${kept.grantId}`)).toMatchObject({ epoch: 1, generation: 2, state: "active", keyThumbprint: "key", latest: { parentFingerprint: proof.fingerprint(kept.refreshToken), bodyHash: "body" } });
});

it("behaves as logout-all when there is nothing to keep", async () => {
	const { model, rows } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const bound = await rotateBound(model, { clientId: client.id, refreshToken: "r" });

	expect(await model.revokeOtherUserOAuthGrants({ userId: reader, keep: undefined })).toEqual({ kept: undefined });

	expect(rows.get(accountRow)).toEqual({ pk: accountRow, epoch: 1 });
	expect(rows.get(`grant#${bound.grantId}`)).toMatchObject({ state: "revoked" });
	expect(await model.getAccessToken(bound.accessToken)).toBeNull();
	expect(rows.get(`credential#${proof.fingerprint(bound.refreshToken)}`)).toMatchObject({ revocation: { cause: "logout-all" } });
});

it.each([
	["never refreshed", async (_model: Model) => "r"],
	["refreshed without a device key", async (model: Model) => {
		const rotated = await model.refresh.rotate({ clientId: client.id, refreshToken: "r", now: Date.now() });
		assert(rotated.ok);
		return rotated.credential.refreshToken;
	}],
])("keeps nothing for a grant that %s, so the change falls back to logout-all", async (_case, prepare) => {
	const { model, rows } = setup();
	const saved = await model.saveToken(token({ access: "a", refresh: "r" }), client, user); assert(saved);
	const current = await prepare(model);

	expect(await model.revokeOtherUserOAuthGrants({ userId: reader, keep: OAuthGrantIdSchema.parse(saved.user.grantId) })).toEqual({ kept: undefined });

	expect(rows.get(accountRow)).toEqual({ pk: accountRow, epoch: 1 });
	expect(await model.getAccessToken("a")).toBeNull();
	const endpoint = tokenEndpoint(model);
	expect((await endpoint.refresh(current)).body).toEqual({ error: "invalid_grant", readplace_reason: "revoked" });
	expect(endpoint.lastRefusal()).toMatchObject({ reason: "logout-all", revocation: { cause: "logout-all" } });
});

it.each([
	["signed out", async (model: Model, bound: RefreshCredential) => { assert((await model.refresh.revoke({ token: bound.refreshToken, now: Date.now(), proof: boundRotation({ clientId: client.id, refreshToken: bound.refreshToken }).proof })).ok); }],
	["was disconnected", async (model: Model) => model.revokeUserOAuthClient({ userId: reader, clientId: iosAppId })],
	["was fenced by a reset", async (model: Model) => model.revokeAllUserOAuthTokens(reader, "logout-all")],
])("keeps nothing for a grant that %s before the change", async (_case, before) => {
	const { model, rows } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const bound = await rotateBound(model, { clientId: client.id, refreshToken: "r" });
	await before(model, bound);
	const epoch = Number(rows.get(accountRow)?.epoch ?? 0);

	expect(await model.revokeOtherUserOAuthGrants({ userId: reader, keep: grantIdOf(bound) })).toEqual({ kept: undefined });

	expect(rows.get(accountRow)).toEqual({ pk: accountRow, epoch: epoch + 1 });
	expect(rows.get(`grant#${bound.grantId}`)).toMatchObject({ state: "revoked" });
	expect(await model.getAccessToken(bound.accessToken)).toBeNull();
});

it.each([
	["with a refresh between them", true, { atEpoch: 2, grantEpoch: 1 }],
	["without a refresh between them", false, { atEpoch: 2, grantEpoch: 0 }],
])("keeps the grant through two changes in a row %s", async (_case, refreshBetween, exemption) => {
	const { model, rows } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	let current = await rotateBound(model, { clientId: client.id, refreshToken: "r" });
	const keep = grantIdOf(current);
	expect(await model.revokeOtherUserOAuthGrants({ userId: reader, keep })).toEqual({ kept: keep });
	if (refreshBetween) current = await rotateBound(model, { clientId: client.id, refreshToken: current.refreshToken });

	expect(await model.revokeOtherUserOAuthGrants({ userId: reader, keep })).toEqual({ kept: keep });

	expect(rows.get(accountRow)).toEqual({ pk: accountRow, epoch: 2, exemption: { grantId: keep, ...exemption } });
	expect(await model.getAccessToken(current.accessToken)).toMatchObject({ accessToken: current.accessToken });
	expect(await rotateBound(model, { clientId: client.id, refreshToken: current.refreshToken })).toMatchObject({ epoch: 2 });
});

it.each(["logout-all", "account-deletion"] as const)("a later %s revokes the kept grant", async cause => {
	const { model, rows } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const bound = await rotateBound(model, { clientId: client.id, refreshToken: "r" });
	await model.revokeOtherUserOAuthGrants({ userId: reader, keep: grantIdOf(bound) });

	await model.revokeAllUserOAuthTokens(reader, cause);

	expect(rows.get(`grant#${bound.grantId}`)).toMatchObject({ state: "revoked" });
	expect(await model.getAccessToken(bound.accessToken)).toBeNull();
	const context: RefreshContext = {};
	expect(await refreshContext.run(context, () => model.refresh.rotate(boundRotation({ clientId: client.id, refreshToken: bound.refreshToken })))).toMatchObject({ reason: "revoked" });
	expect(context.reason).toBe(cause);
});

it("keeps the grant while a rotation of it is in flight", async () => {
	const { model } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const bound = await rotateBound(model, { clientId: client.id, refreshToken: "r" });

	const [rotated, outcome] = await Promise.all([
		model.refresh.rotate(boundRotation({ clientId: client.id, refreshToken: bound.refreshToken })),
		model.revokeOtherUserOAuthGrants({ userId: reader, keep: grantIdOf(bound) }),
	]);

	assert(rotated.ok);
	expect(outcome).toEqual({ kept: bound.grantId });
	expect(await model.getAccessToken(rotated.credential.accessToken)).toMatchObject({ accessToken: rotated.credential.accessToken });
});

it.each([
	["between the rotation's locate and its grant read", (input: z.infer<typeof commandSchema>) => input.Key?.pk.startsWith("grant#") === true],
	["before the rotation's account read", (input: z.infer<typeof commandSchema>) => input.Key?.pk === accountRow],
	["just before the rotation's commit", (input: z.infer<typeof commandSchema>) => input.TransactItems !== undefined],
])("keeps the grant when the change lands %s", async (_when, trigger) => {
	const { model, controls } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const bound = await rotateBound(model, { clientId: client.id, refreshToken: "r" });
	let outcome: { kept: OAuthGrantId | undefined } | undefined;
	controls.beforeSend = async input => {
		if (!trigger(input)) return;
		controls.beforeSend = undefined;
		outcome = await model.revokeOtherUserOAuthGrants({ userId: reader, keep: grantIdOf(bound) });
	};

	const rotated = await rotateBound(model, { clientId: client.id, refreshToken: bound.refreshToken });

	expect(outcome).toEqual({ kept: bound.grantId });
	expect(rotated).toMatchObject({ generation: 2 });
	expect(await model.getAccessToken(rotated.accessToken)).toMatchObject({ accessToken: rotated.accessToken });
});

it("reads again when a rotation lands between the keep's reads and its transaction", async () => {
	const { model, rows, controls, transactions } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const bound = await rotateBound(model, { clientId: client.id, refreshToken: "r" });
	let rotated: RefreshCredential | undefined;
	controls.beforeSend = async input => {
		if (!input.TransactItems) return;
		controls.beforeSend = undefined;
		rotated = await rotateBound(model, { clientId: client.id, refreshToken: bound.refreshToken });
	};

	expect(await model.revokeOtherUserOAuthGrants({ userId: reader, keep: grantIdOf(bound) })).toEqual({ kept: bound.grantId });

	assert(rotated);
	const keeps = z.array(z.object({ TransactItems: z.array(z.object({ Update: z.object({ Key: z.object({ pk: z.string() }) }).optional() })) })).parse(transactions)
		.filter(transaction => transaction.TransactItems[0]?.Update?.Key.pk === accountRow);
	expect(keeps).toHaveLength(2);
	expect(rows.get(accountRow)).toEqual({ pk: accountRow, epoch: 1, exemption: { atEpoch: 1, grantId: bound.grantId, grantEpoch: 0 } });
	expect(await model.getAccessToken(rotated.accessToken)).toMatchObject({ accessToken: rotated.accessToken });
});

it("recovers a replay across the change with the same credentials", async () => {
	const { model } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const operationId = randomUUID();
	const bound = await rotateBound(model, { clientId: client.id, refreshToken: "r", operationId });
	expect(await model.revokeOtherUserOAuthGrants({ userId: reader, keep: grantIdOf(bound) })).toEqual({ kept: bound.grantId });

	const replayed = await model.refresh.rotate(boundRotation({ clientId: client.id, refreshToken: "r", operationId }));

	expect(replayed).toEqual({ ok: true, recovered: true, credential: bound });
});

it.each([
	["logout", async (model: Model, bound: RefreshCredential) => { assert((await model.refresh.revoke({ token: bound.refreshToken, now: Date.now(), proof: boundRotation({ clientId: client.id, refreshToken: bound.refreshToken }).proof })).ok); }],
	["disconnect", async (model: Model) => model.revokeUserOAuthClient({ userId: reader, clientId: iosAppId })],
])("a %s racing the change still revokes the kept grant", async (cause, revoke) => {
	const { model, rows, controls } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const bound = await rotateBound(model, { clientId: client.id, refreshToken: "r" });
	controls.beforeSend = async input => {
		if (input.Key?.pk !== accountRow) return;
		controls.beforeSend = undefined;
		expect(await model.revokeOtherUserOAuthGrants({ userId: reader, keep: grantIdOf(bound) })).toEqual({ kept: bound.grantId });
	};

	await revoke(model, bound);

	expect(rows.get(`grant#${bound.grantId}`)).toMatchObject({ state: "revoked" });
	expect(await model.getAccessToken(bound.accessToken)).toBeNull();
	const context: RefreshContext = {};
	expect(await refreshContext.run(context, () => model.refresh.rotate(boundRotation({ clientId: client.id, refreshToken: bound.refreshToken })))).toMatchObject({ reason: "revoked" });
	expect(context.reason).toBe(cause);
});

it("recovers a replayed refresh when the kept grant's rotation and a second change both land inside its reads", async () => {
	const { model, rows, controls } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const bound = await rotateBound(model, { clientId: client.id, refreshToken: "r" });
	const keep = grantIdOf(bound);
	expect(await model.revokeOtherUserOAuthGrants({ userId: reader, keep })).toEqual({ kept: keep });
	const first = await rotateBound(model, { clientId: client.id, refreshToken: bound.refreshToken });
	const operationId = randomUUID();
	let second: RefreshCredential | undefined;
	controls.beforeSend = async input => {
		if (input.Key?.pk !== accountRow) return;
		controls.beforeSend = undefined;
		second = await rotateBound(model, { clientId: client.id, refreshToken: first.refreshToken, operationId });
		expect(await model.revokeOtherUserOAuthGrants({ userId: reader, keep })).toEqual({ kept: keep });
	};

	const recovered = await model.refresh.rotate(boundRotation({ clientId: client.id, refreshToken: first.refreshToken, operationId }));

	assert(second);
	expect(recovered).toEqual({ ok: true, recovered: true, credential: second });
	expect(rows.get(accountRow)).toEqual({ pk: accountRow, epoch: 2, exemption: { atEpoch: 2, grantId: keep, grantEpoch: 1 } });
	expect(await model.getAccessToken(second.accessToken)).toMatchObject({ accessToken: second.accessToken });
});

it.each([
	["logout", async (model: Model, current: RefreshCredential) => { assert((await model.refresh.revoke({ token: current.refreshToken, now: Date.now(), proof: boundRotation({ clientId: client.id, refreshToken: current.refreshToken }).proof })).ok); }],
	["disconnect", async (model: Model) => model.revokeUserOAuthClient({ userId: reader, clientId: iosAppId })],
])("a %s revokes the kept grant when its rotation and a second change both land inside its reads", async (cause, revoke) => {
	const { model, rows, controls } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const bound = await rotateBound(model, { clientId: client.id, refreshToken: "r" });
	const keep = grantIdOf(bound);
	expect(await model.revokeOtherUserOAuthGrants({ userId: reader, keep })).toEqual({ kept: keep });
	const first = await rotateBound(model, { clientId: client.id, refreshToken: bound.refreshToken });
	let second: RefreshCredential | undefined;
	controls.beforeSend = async input => {
		if (input.Key?.pk !== accountRow) return;
		controls.beforeSend = undefined;
		second = await rotateBound(model, { clientId: client.id, refreshToken: first.refreshToken });
		expect(await model.revokeOtherUserOAuthGrants({ userId: reader, keep })).toEqual({ kept: keep });
	};

	await revoke(model, first);

	assert(second);
	const child = second;
	expect(rows.get(`grant#${keep}`)).toMatchObject({ state: "revoked", epoch: 1, generation: 3 });
	expect(await model.getAccessToken(child.accessToken)).toBeNull();
	expect(await model.listUserOAuthClients(reader)).toEqual([]);
	const context: RefreshContext = {};
	expect(await refreshContext.run(context, () => model.refresh.rotate(boundRotation({ clientId: client.id, refreshToken: child.refreshToken })))).toMatchObject({ reason: "revoked" });
	expect(context.reason).toBe(cause);
});

it("keeps with one transaction that moves the epoch and pins the grant row it read", async () => {
	const { model, transactions } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const bound = await rotateBound(model, { clientId: client.id, refreshToken: "r" });
	const before = transactions.length;

	await model.revokeOtherUserOAuthGrants({ userId: reader, keep: grantIdOf(bound) });

	expect(transactions.slice(before)).toEqual([{ TransactItems: [
		{ Update: { TableName: "oauth", Key: { pk: accountRow }, UpdateExpression: "SET epoch = :next, exemption = :exemption",
			ConditionExpression: "attribute_not_exists(deletedAt) AND (attribute_not_exists(epoch) OR epoch = :epoch)",
			ExpressionAttributeValues: { ":epoch": 0, ":next": 1, ":exemption": { atEpoch: 1, grantId: bound.grantId, grantEpoch: 0 } } } },
		{ ConditionCheck: { TableName: "oauth", Key: { pk: `grant#${bound.grantId}` },
			ConditionExpression: "generation = :generation AND #state = :state AND accessToken = :access AND epoch = :epoch",
			ExpressionAttributeNames: { "#state": "state" },
			ExpressionAttributeValues: { ":generation": 1, ":state": "active", ":access": bound.accessToken, ":epoch": 0 } } },
	] }]);
});

it("answers conflict and writes nothing when the account is already at another epoch", async () => {
	const { model, rows, store } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const bound = await rotateBound(model, { clientId: client.id, refreshToken: "r" });
	const grant = await store.store.readGrant(bound.grantId); assert(grant);
	rows.set(accountRow, { pk: accountRow, epoch: 1 });

	expect(await store.advanceEpochKeeping({ userId: user.id, exemption: { atEpoch: 1, grantId: bound.grantId, grantEpoch: 0 }, expectedGrant: grant })).toBe("conflict");

	expect(rows.get(accountRow)).toEqual({ pk: accountRow, epoch: 1 });
});

it.each([
	new Error("unavailable"),
	new TransactionCanceledException({ $metadata: {}, message: "throttled", CancellationReasons: [{ Code: "ProvisionedThroughputExceeded" }] }),
	new TransactionCanceledException({ $metadata: {}, message: "unspecified cancellation" }),
])("rethrows a keep that failed for a reason other than a lost race and leaves the grant working: %s", async failure => {
	const { model, rows, controls } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const bound = await rotateBound(model, { clientId: client.id, refreshToken: "r" });
	rows.set(accountRow, { pk: accountRow, epoch: 0 });
	controls.transactionFailure = failure;

	await expect(model.revokeOtherUserOAuthGrants({ userId: reader, keep: grantIdOf(bound) })).rejects.toBe(failure);

	controls.transactionFailure = undefined;
	expect(rows.get(accountRow)).toEqual({ pk: accountRow, epoch: 0 });
	expect(await model.getAccessToken(bound.accessToken)).toMatchObject({ accessToken: bound.accessToken });
});

it("retries a keep whose transaction lost a race and keeps the grant", async () => {
	const { model, rows, controls } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const bound = await rotateBound(model, { clientId: client.id, refreshToken: "r" });
	let sent = 0;
	controls.beforeSend = async input => {
		if (!input.TransactItems) return;
		sent += 1;
		controls.transactionFailure = sent === 1 ? new TransactionCanceledException({ $metadata: {}, message: "lost race", CancellationReasons: [{ Code: "TransactionConflict" }] }) : undefined;
	};

	expect(await model.revokeOtherUserOAuthGrants({ userId: reader, keep: grantIdOf(bound) })).toEqual({ kept: bound.grantId });

	expect(sent).toBe(2);
	expect(rows.get(accountRow)).toEqual({ pk: accountRow, epoch: 1, exemption: { atEpoch: 1, grantId: bound.grantId, grantEpoch: 0 } });
	expect(await model.getAccessToken(bound.accessToken)).toMatchObject({ accessToken: bound.accessToken });
});

it.each(["logout-all", "account-deletion"] as const)("falls back to a full logout-all when a %s lands between the keep's reads and its transaction", async cause => {
	const { model, rows, controls } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const bound = await rotateBound(model, { clientId: client.id, refreshToken: "r" });
	controls.beforeSend = async input => {
		if (!input.Key?.pk.startsWith("grant#")) return;
		controls.beforeSend = undefined;
		await model.revokeAllUserOAuthTokens(reader, cause);
	};

	expect(await model.revokeOtherUserOAuthGrants({ userId: reader, keep: grantIdOf(bound) })).toEqual({ kept: undefined });

	expect(rows.get(accountRow)).toEqual(cause === "account-deletion" ? { pk: accountRow, epoch: 2, deletedAt: expect.any(Number) } : { pk: accountRow, epoch: 2 });
	expect(await model.getAccessToken(bound.accessToken)).toBeNull();
	const context: RefreshContext = {};
	expect(await refreshContext.run(context, () => model.refresh.rotate(boundRotation({ clientId: client.id, refreshToken: bound.refreshToken })))).toMatchObject({ reason: "revoked" });
	expect(context.reason).toBe(cause);
});

it("disconnects a connection that signed in just before the change and is not yet listed in userId-index", async () => {
	const { model, controls } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const bound = await rotateBound(model, { clientId: client.id, refreshToken: "r" });
	await model.saveToken(token({ access: "b", refresh: "s" }), chrome, user);
	controls.unindexed = new Set(["token#b"]);

	expect(await model.revokeOtherUserOAuthGrants({ userId: reader, keep: grantIdOf(bound) })).toEqual({ kept: bound.grantId });

	expect(await model.getAccessToken("b")).toBeNull();
	expect(await model.refresh.rotate({ clientId: chrome.id, refreshToken: "s", now: Date.now() })).toMatchObject({ reason: "revoked" });
	expect(await rotateBound(model, { clientId: client.id, refreshToken: bound.refreshToken })).toMatchObject({ epoch: 1, generation: 2 });
});

it("a sweep that fails after its first revocation still leaves every other grant refused and the kept grant working", async () => {
	const { model, rows, controls } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const bound = await rotateBound(model, { clientId: client.id, refreshToken: "r" });
	await model.saveToken(token({ access: "b", refresh: "s" }), chrome, user);
	await model.saveToken(token({ access: "c", refresh: "t" }), firefox, user);
	controls.beforeSend = async input => {
		if (input.TransactItems?.some(entry => entry.Delete?.Key.pk === "token#c")) throw new Error("sweep failed");
	};

	await expect(model.revokeOtherUserOAuthGrants({ userId: reader, keep: grantIdOf(bound) })).rejects.toThrow("sweep failed");

	controls.beforeSend = undefined;
	expect(rows.get(`credential#${proof.fingerprint("s")}`)).toMatchObject({ revocation: { cause: "logout-all" } });
	expect(rows.has("token#c")).toBe(true);
	expect([await model.getAccessToken("b"), await model.getAccessToken("c")]).toEqual([null, null]);
	expect(await model.refresh.rotate({ clientId: chrome.id, refreshToken: "s", now: Date.now() })).toMatchObject({ reason: "revoked" });
	expect(await model.refresh.rotate({ clientId: firefox.id, refreshToken: "t", now: Date.now() })).toMatchObject({ reason: "revoked" });
	expect(await rotateBound(model, { clientId: client.id, refreshToken: bound.refreshToken })).toMatchObject({ epoch: 1, generation: 2 });
});

it.each([
	["with nothing to keep", false],
	["beside a kept grant", true],
])("revokes a legacy token row without a grant id %s", async (_case, withKeep) => {
	const { model, rows } = setup();
	await model.saveToken(token({ access: "a", refresh: "r" }), client, user);
	const bound = await rotateBound(model, { clientId: client.id, refreshToken: "r" });
	await model.saveToken(token({ access: "l", refresh: "legacy" }), chrome, user);
	const legacy = rows.get("token#l"); assert(legacy); delete legacy.grantId;
	rows.delete(`credential#${proof.fingerprint("legacy")}`);

	expect(await model.revokeOtherUserOAuthGrants({ userId: reader, keep: withKeep ? grantIdOf(bound) : undefined })).toEqual({ kept: withKeep ? bound.grantId : undefined });

	expect([rows.has("token#l"), rows.has("refresh#legacy")]).toEqual([false, false]);
	expect(rows.get(`credential#${proof.fingerprint("legacy")}`)).toMatchObject({ revocation: { cause: "logout-all" } });
	expect(await model.getAccessToken(bound.accessToken)).toEqual(withKeep ? expect.objectContaining({ accessToken: bound.accessToken }) : null);
});
