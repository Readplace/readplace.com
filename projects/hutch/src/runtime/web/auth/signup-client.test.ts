import assert from "node:assert/strict";
import type { OAuthClient } from "@packages/domain/oauth";
import { OAuthClientIdSchema } from "@packages/domain/oauth";
import { initResolveSignupClient, signupClientOrOther } from "./signup-client";

const DYNAMIC_ID = OAuthClientIdSchema.parse("dynamic-client-id");

function resolverFor(registeredName: string | undefined) {
	const lookedUp: string[] = [];
	const resolve = initResolveSignupClient({
		findOAuthClient: async (clientId) => {
			lookedUp.push(clientId);
			if (registeredName === undefined) return undefined;
			const client: OAuthClient = { id: OAuthClientIdSchema.parse(clientId), name: registeredName, redirectUris: [], grants: [] };
			return client;
		},
	});
	return { resolve, lookedUp };
}

describe("initResolveSignupClient", () => {
	it("answers other for a signup with no OAuth client, with no lookup", async () => {
		const { resolve, lookedUp } = resolverFor("ChatGPT");

		assert.equal(await resolve(null), "other");
		assert.deepEqual(lookedUp, []);
	});

	it("answers other for a built-in client, with no lookup", async () => {
		const { resolve, lookedUp } = resolverFor("ChatGPT");

		assert.equal(await resolve(OAuthClientIdSchema.parse("hutch-chrome-extension")), "other");
		assert.deepEqual(lookedUp, []);
	});

	it.each([
		["ChatGPT", "chatgpt"],
		["chatgpt ", "chatgpt"],
		["Claude", "claude"],
		["Gemini", "other"],
		["Some Other App", "other"],
	])("answers for a dynamic client registered as %j", async (registeredName, expected) => {
		const { resolve, lookedUp } = resolverFor(registeredName);

		assert.equal(await resolve(DYNAMIC_ID), expected);
		assert.deepEqual(lookedUp, [DYNAMIC_ID]);
	});

	it("answers other for an id with no client", async () => {
		const { resolve } = resolverFor(undefined);

		assert.equal(await resolve(DYNAMIC_ID), "other");
	});
});

describe("signupClientOrOther", () => {
	function recordingLog() {
		const logged: { message: string; error: Error | undefined }[] = [];
		return {
			logged,
			logError: (message: string, error?: Error) => {
				logged.push({ message, error });
			},
		};
	}

	it("passes a resolved client through and logs nothing", async () => {
		const { logged, logError } = recordingLog();

		assert.equal(await signupClientOrOther({ resolve: async () => "claude", logError }), "claude");
		assert.deepEqual(logged, []);
	});

	it("logs a thrown error and answers other", async () => {
		const { logged, logError } = recordingLog();
		const failure = new Error("table unavailable");

		const client = await signupClientOrOther({
			resolve: async () => {
				throw failure;
			},
			logError,
		});

		assert.equal(client, "other");
		assert.deepEqual(logged, [{ message: "[Email] Signup client lookup failed", error: failure }]);
	});

	it("wraps a thrown value that is not an Error", async () => {
		const { logged, logError } = recordingLog();

		const client = await signupClientOrOther({
			resolve: () => Promise.reject("table unavailable"),
			logError,
		});

		assert.equal(client, "other");
		assert.equal(logged[0]?.error?.message, "table unavailable");
	});
});
