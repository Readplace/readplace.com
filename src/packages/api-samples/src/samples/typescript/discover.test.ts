import assert from "node:assert/strict";
import { ZodError } from "zod";
import { type CannedServer, startCannedServer } from "./canned-server";
import { discover } from "./discover";

const SIREN = "application/vnd.siren+json";
const COLLECTION = JSON.stringify({
	class: ["collection"],
	actions: [{ name: "save-article", href: "/queue", method: "POST", type: "application/json" }],
});
const COLLECTION_ANSWER = { status: 200, headers: { "Content-Type": SIREN }, body: COLLECTION };

describe("discover", () => {
	let server: CannedServer | undefined;

	afterEach(async () => {
		await server?.close();
		server = undefined;
	});

	it("parses the collection the entry point answers, sending the token and Siren accept", async () => {
		server = await startCannedServer({ "GET /": COLLECTION_ANSWER });

		const collection = await discover({ origin: server.origin, token: "token-1" });

		assert.deepEqual(collection.actions, [
			{ name: "save-article", href: "/queue", method: "POST", type: "application/json" },
		]);
		assert.deepEqual(
			server.requests.map((request) => [request.path, request.headers.authorization, request.headers.accept]),
			[["/", "Bearer token-1", SIREN]],
		);
	});

	it("rejects when the entry point redirects", async () => {
		server = await startCannedServer({ "GET /": { status: 303, headers: { Location: "/queue" } } });

		await assert.rejects(discover({ origin: server.origin, token: "token-1" }), /answered 303/);
	});

	it("rejects when the entry point is refused", async () => {
		server = await startCannedServer({ "GET /": { status: 401, body: "{}" } });

		await assert.rejects(discover({ origin: server.origin, token: "token-1" }), /answered 401/);
	});

	it("rejects an entry point body that is not a Siren collection", async () => {
		server = await startCannedServer({ "GET /": { status: 200, body: JSON.stringify({ actions: "none" }) } });

		await assert.rejects(discover({ origin: server.origin, token: "token-1" }), ZodError);
	});
});
