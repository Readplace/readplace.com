import assert from "node:assert/strict";
import { ZodError } from "zod";
import { type CannedServer, startCannedServer } from "./canned-server";
import type { SirenCollection } from "./discover";
import { saveArticle } from "./save-article";

const SIREN = "application/vnd.siren+json";
const SAVED = JSON.stringify({ class: ["article"], properties: { url: "https://example.com/a" } });

function collectionWith(type?: string): SirenCollection {
	return { actions: [{ name: "save-article", href: "/queue", method: "POST", type }] };
}

describe("saveArticle", () => {
	let server: CannedServer | undefined;

	afterEach(async () => {
		await server?.close();
		server = undefined;
	});

	it("sends the advertised action with the token, Siren accept and representation preference", async () => {
		server = await startCannedServer({ "POST /queue": { status: 201, body: SAVED } });

		const saved = await saveArticle({
			origin: server.origin,
			token: "token-1",
			collection: collectionWith("application/vnd.readplace+json"),
			url: "https://example.com/a",
		});

		assert.deepEqual(saved, { class: ["article"], properties: { url: "https://example.com/a" } });
		const [request] = server.requests;
		assert.equal(request.method, "POST");
		assert.equal(request.headers["content-type"], "application/vnd.readplace+json");
		assert.equal(request.headers.prefer, "return=representation");
		assert.equal(request.headers.authorization, "Bearer token-1");
		assert.equal(request.headers.accept, SIREN);
		assert.deepEqual(JSON.parse(request.body), { url: "https://example.com/a" });
	});

	it("sends JSON when the action names no type", async () => {
		server = await startCannedServer({ "POST /queue": { status: 201, body: SAVED } });

		await saveArticle({ origin: server.origin, token: "token-1", collection: collectionWith(), url: "https://example.com/a" });

		assert.equal(server.requests[0].headers["content-type"], "application/json");
	});

	it("sends the readlists to add the article to", async () => {
		server = await startCannedServer({ "POST /queue": { status: 201, body: SAVED } });

		await saveArticle({
			origin: server.origin,
			token: "token-1",
			collection: collectionWith(),
			url: "https://example.com/a",
			readlists: ["/readlists/r1"],
		});

		assert.deepEqual(JSON.parse(server.requests[0].body), {
			url: "https://example.com/a",
			readlists: ["/readlists/r1"],
		});
	});

	it("rejects a collection that advertises no save-article action", async () => {
		await assert.rejects(
			saveArticle({ origin: "http://127.0.0.1:1", token: "token-1", collection: { actions: [] }, url: "https://example.com/a" }),
			/no save-article action/,
		);
	});

	it("rejects when the save is refused", async () => {
		server = await startCannedServer({ "POST /queue": { status: 409, body: "{}" } });

		await assert.rejects(
			saveArticle({ origin: server.origin, token: "token-1", collection: collectionWith(), url: "https://example.com/a" }),
			/save-article answered 409/,
		);
	});

	it("rejects a saved body that is not an article entity", async () => {
		server = await startCannedServer({ "POST /queue": { status: 201, body: JSON.stringify({ class: "article" }) } });

		await assert.rejects(
			saveArticle({ origin: server.origin, token: "token-1", collection: collectionWith(), url: "https://example.com/a" }),
			ZodError,
		);
	});
});
