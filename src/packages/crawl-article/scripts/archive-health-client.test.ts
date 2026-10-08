import assert from "node:assert/strict";
import { initArchiveHealthClient } from "./archive-health-client";

const LOGIN = '<form method="POST" action="/login?source=canary" data-test-form="login"><input type="hidden" name="csrf" value="token"></form>';
const SAVE = '<form method="POST" action="/queue/save?source=canary" data-test-form="save-article"></form>';
const ATTEMPT = "12c9f733-a806-4734-9d76-2d466e41d473";

function clientFor(responses: Response[]) {
	const calls: { url: string; init: RequestInit }[] = [];
	const client = initArchiveHealthClient({
		origin: "https://readplace.example",
		email: "canary@example.com",
		password: "canary-password",
		fetch: async (url, init) => {
			calls.push({ url, init });
			const response = responses.shift();
			assert(response, "unexpected request");
			return response;
		},
	});
	return { client, calls };
}

it("logs in once with existing credentials, keeps its session and discovers the normal save action", async () => {
	const { client, calls } = clientFor([
		new Response(LOGIN),
		new Response("", { status: 303, headers: { location: "/queue", "set-cookie": "hutch_sid=canary-session; HttpOnly; Secure" } }),
		new Response(SAVE),
		new Response("", { status: 303, headers: { location: "/queue#latest-saved", "x-readplace-save-attempt-id": ATTEMPT } }),
	]);
	await client.login();
	expect(await client.save("https://web.archive.org/web/2008/https://example.com/article")).toBe(ATTEMPT);
	expect(calls.map(({ url }) => url)).toEqual([
		"https://readplace.example/login", "https://readplace.example/login?source=canary",
		"https://readplace.example/queue", "https://readplace.example/queue/save?source=canary",
	]);
	expect(calls[1].init.body?.toString()).toBe("csrf=token&email=canary%40example.com&password=canary-password");
	expect(calls[3].init).toMatchObject({ method: "POST", redirect: "manual", headers: { cookie: "hutch_sid=canary-session" } });
});

it("uploads the reader's page through the Siren save-content action with its session", async () => {
	const { client, calls } = clientFor([
		new Response(LOGIN),
		new Response("", { status: 303, headers: { location: "/queue", "set-cookie": "hutch_sid=canary-session; HttpOnly; Secure" } }),
		new Response(JSON.stringify({ actions: [{ name: "save", href: "/queue/save" }, { name: "save-content", href: "/queue/save-content" }] })),
		new Response("{}", { status: 201 }),
	]);
	await client.login();
	await client.upload({ url: "https://readplace.com/crawl-canary/upload/run", title: "Upload", html: "<p>marker</p>" });
	expect(calls.slice(2).map(({ url, init }) => [url, init.method, init.headers])).toEqual([
		["https://readplace.example/queue", "GET", { cookie: "hutch_sid=canary-session", accept: "application/vnd.siren+json" }],
		["https://readplace.example/queue/save-content", "POST", { cookie: "hutch_sid=canary-session", accept: "application/vnd.siren+json" }],
	]);
	const body = calls[3].init.body;
	assert(body instanceof FormData);
	expect([body.get("url"), body.get("title"), body.get("mediaType")]).toEqual(["https://readplace.com/crawl-canary/upload/run", "Upload", "text/html"]);
	const content = body.get("content");
	assert(content instanceof Blob);
	expect(await content.text()).toBe("<p>marker</p>");
});

it.each([
	{ label: "the Siren collection redirects to login", responses: () => [new Response("", { status: 302 })], error: "Siren collection must load" },
	{ label: "save-content is not advertised", responses: () => [new Response(JSON.stringify({ actions: [] }))], error: "must advertise save-content" },
	{ label: "the upload is refused", responses: () => [new Response(JSON.stringify({ actions: [{ name: "save-content", href: "/queue/save-content" }] })), new Response("", { status: 402 })], error: "upload must be accepted" },
])("fails the upload when $label", async ({ responses, error }) => {
	const { client } = clientFor(responses());
	await expect(client.upload({ url: "https://readplace.com/crawl-canary/upload/run", title: "Upload", html: "<p>marker</p>" })).rejects.toThrow(error);
});

it("refuses a cross-origin login action before sending credentials", async () => {
	const { client, calls } = clientFor([new Response(LOGIN.replace("/login?source=canary", "https://other.example/login"))]);
	await expect(client.login()).rejects.toThrow("configured origin");
	expect(calls).toHaveLength(1);
});

it("fails when login does not reach an authenticated readlist", async () => {
	const { client } = clientFor([new Response(LOGIN), new Response("Invalid password", { status: 401 })]);
	await expect(client.login()).rejects.toThrow("canary account login failed");
});

it("rejects a save refusal even when it returns a redirect", async () => {
	const { client } = clientFor([new Response(SAVE), new Response("", { status: 303, headers: { location: "/queue?error_code=save_failed", "x-readplace-save-attempt-id": ATTEMPT } })]);
	await expect(client.save("https://example.com/article")).rejects.toThrow("save was refused");
});

it("requires correlation from the accepted save rather than treating a redirect as completion", async () => {
	const { client } = clientFor([new Response(SAVE), new Response("", { status: 303, headers: { location: "/queue" } })]);
	await expect(client.save("https://example.com/article")).rejects.toThrow("accepted save must return its save attempt id");
});

it("checks the original card identity and rejects duplicate original cards", async () => {
	const card = '<article data-test-article="original-card" id="latest-saved"><a data-test-article-url href="http://example.com/article">Original</a></article>';
	const { client } = clientFor([new Response(card), new Response(card + card)]);
	expect(await client.findOnlyCard("https://example.com/article")).toBe("original-card");
	await expect(client.findOnlyCard("https://example.com/article")).rejects.toThrow("at most one");
});

it("cannot satisfy original identity with an old card keyed on the archive URL", async () => {
	const { client } = clientFor([new Response('<article data-test-article="old-card"><a data-test-article-url href="https://web.archive.org/web/2008/https://example.com/article">Archive</a></article>')]);
	expect(await client.findOnlyCard("https://example.com/article")).toBeUndefined();
});

it("does not mistake an unchanged original card for a successful direct save when the save created a redirected card", async () => {
	const { client } = clientFor([new Response('<article data-test-article="wrong-card" id="latest-saved"><a data-test-article-url href="https://example.com/">Homepage</a></article><article data-test-article="original-card"><a data-test-article-url href="https://example.com/article">Original</a></article>')]);
	await expect(client.findOnlyCard("https://example.com/article")).rejects.toThrow("accepted save must put the original card at the top");
});
