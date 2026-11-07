import assert from "node:assert/strict";
import { ZodError } from "zod";
import { type CannedServer, startCannedServer } from "./canned-server";
import { discover } from "./discover";

const SIREN = "application/vnd.siren+json";
const COLLECTION = JSON.stringify({
	class: ["collection"],
	actions: [{ name: "save-article", href: "/queue", method: "POST", type: "application/json" }],
});
const REDIRECT = { status: 303, headers: { Location: "/queue" } };

describe("discover", () => {
	let server: CannedServer | undefined;

	afterEach(async () => {
		await server?.close();
		server = undefined;
	});

	it("follows the entry point redirect and parses the collection, sending the token and Siren accept on both requests", async () => {
		server = await startCannedServer({
			"GET /": REDIRECT,
			"GET /queue": { status: 200, headers: { "Content-Type": SIREN }, body: COLLECTION },
		});

		const collection = await discover({ origin: server.origin, token: "token-1" });

		assert.deepEqual(collection.actions, [
			{ name: "save-article", href: "/queue", method: "POST", type: "application/json" },
		]);
		assert.deepEqual(
			server.requests.map((request) => [request.path, request.headers.authorization, request.headers.accept]),
			[
				["/", "Bearer token-1", SIREN],
				["/queue", "Bearer token-1", SIREN],
			],
		);
	});

	it("rejects when the entry point does not redirect", async () => {
		server = await startCannedServer({ "GET /": { status: 200, body: "{}" } });

		await assert.rejects(discover({ origin: server.origin, token: "token-1" }), /answered 200/);
	});

	it("rejects when the redirect carries no Location header", async () => {
		server = await startCannedServer({ "GET /": { status: 303 } });

		await assert.rejects(discover({ origin: server.origin, token: "token-1" }), /no Location header/);
	});

	it("rejects when the collection is refused", async () => {
		server = await startCannedServer({ "GET /": REDIRECT, "GET /queue": { status: 401, body: "{}" } });

		await assert.rejects(discover({ origin: server.origin, token: "token-1" }), /collection answered 401/);
	});

	it("rejects a collection body that is not a Siren collection", async () => {
		server = await startCannedServer({
			"GET /": REDIRECT,
			"GET /queue": { status: 200, body: JSON.stringify({ actions: "none" }) },
		});

		await assert.rejects(discover({ origin: server.origin, token: "token-1" }), ZodError);
	});
});
