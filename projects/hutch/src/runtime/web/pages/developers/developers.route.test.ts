import assert from "node:assert/strict";
import matter from "gray-matter";
import { JSDOM } from "jsdom";
import request from "supertest";
import { MinutesSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { SUPPORTED_CLIENTS } from "@packages/supported-clients";
import { useTestServer } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture, createFakeSummaryProvider } from "@packages/test-fixtures";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { createAccessToken } from "../../test-helpers/oauth-token";

const useApp = useTestServer();

type Harness = ReturnType<typeof useApp>;

function pageRoot(html: string): Element {
	const root = new JSDOM(html).window.document.querySelector("[data-test-developers]");
	assert(root, "the developers page root must render");
	return root;
}

function sirenGet(harness: Harness, params: { path: string; token: string }) {
	return request(harness.server)
		.get(params.path)
		.set("Accept", SIREN_MEDIA_TYPE)
		.set("Authorization", `Bearer ${params.token}`)
		.redirects(0);
}

async function followRedirects(
	harness: Harness,
	params: { response: request.Response; token: string },
): Promise<request.Response> {
	let response = params.response;
	while (response.status >= 300 && response.status < 400) {
		response = await sirenGet(harness, { path: response.headers.location, token: params.token });
	}
	return response;
}

async function openAll(harness: Harness, token: string): Promise<request.Response> {
	const entry = await sirenGet(harness, { path: "/", token });
	assert.equal(entry.status, 303, "the entry point must redirect to the collection");
	return followRedirects(harness, { response: entry, token });
}

interface Action {
	name: string;
	href: string;
	fields?: { name: string; value?: string }[];
}

function actionNamed(body: { actions?: Action[] }, name: string): Action {
	const action = body.actions?.find((candidate) => candidate.name === name);
	assert(action, `expected a ${name} action`);
	return action;
}

function namesOf(body: { actions?: Action[]; entities?: { actions?: Action[] }[] }): string[] {
	return [
		...(body.actions ?? []).map((action) => action.name),
		...(body.entities ?? []).flatMap((entity) => (entity.actions ?? []).map((action) => action.name)),
	];
}

function marked(root: Element, attribute: string): string[] {
	return Array.from(root.querySelectorAll(`[${attribute}]`), (node) =>
		(node.textContent ?? "").replace(/\s+/g, " ").trim(),
	);
}

async function readPage(harness: Harness): Promise<Element> {
	return pageRoot((await request(harness.server).get("/developers")).text);
}

describe("GET /developers", () => {
	it.each([
		["text/html", "text/html,application/xhtml+xml"],
		["*/*", "*/*"],
		["empty Accept", ""],
	])("serves the HTML page to a request that sends %s", async (_label, accept) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/developers").set("Accept", accept);

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
		expect(pageRoot(response.text).querySelector("h1")?.textContent).toBe("Build on the Readplace API");
	});

	it("serves the HTML page when no Accept header is sent", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/developers");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
		expect(pageRoot(response.text).querySelector("h1")?.textContent).toBe("Build on the Readplace API");
	});

	it("renders one section per heading", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const sections = Array.from((await readPage(harness)).querySelectorAll("[data-test-section]"), (section) =>
			section.getAttribute("data-test-section"),
		);

		expect(sections).toEqual([
			"overview",
			"authentication",
			"discovery",
			"collection",
			"articles",
			"saving",
			"status",
			"readlists",
			"caching",
			"errors",
			"limits",
			"not-in-the-api",
			"walkthrough",
		]);
	});

	it("returns the page as Markdown with every sample as a fenced http block", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const samples = Array.from((await readPage(harness)).querySelectorAll("[data-test-sample]"), (sample) =>
			sample.textContent ?? "",
		);

		const response = await request(harness.server).get("/developers").set("Accept", "text/markdown");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(response.text.split("\n")[0]).toBe("# Build on the Readplace API — Readplace");
		for (const sample of samples) {
			expect(response.text).toContain(`\`\`\`http\n${sample}\n\`\`\``);
		}
		expect(response.text.split("```http\n").length - 1).toBe(11);
		expect(response.text).not.toContain("<script");
	});
});

describe("/developers documents what the API emits", () => {
	it("documents exactly the actions the API advertises", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await createAccessToken(harness);
		const root = await readPage(harness);

		const created = await request(harness.server)
			.post(actionNamed((await openAll(harness, token)).body, "create-readlist").href)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.type("form")
			.send({ label: "Parity" })
			.redirects(0);
		expect(created.status).toBe(303);
		const beforeSave = await openAll(harness, token);
		const parity = beforeSave.body.properties.readlists.find(
			(entry: { label: string }) => entry.label === "Parity",
		);
		assert(parity, "the created readlist must be advertised");
		const saved = await request(harness.server)
			.post(actionNamed(beforeSave.body, "save-article").href)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.type("json")
			.send({ url: "https://example.com/parity", readlists: [parity.href] });
		expect(saved.status).toBe(201);
		const named = await followRedirects(harness, {
			response: await sirenGet(harness, { path: parity.href, token }),
			token,
		});
		expect(named.status).toBe(200);
		expect(named.body.entities.map((entity: { properties: { url: string } }) => entity.properties.url)).toEqual([
			"https://example.com/parity",
		]);
		const all = await openAll(harness, token);
		const slot = await request(harness.server)
			.post(actionNamed(all.body, "save-content").href)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.field("url", "https://example.com/big.pdf")
			.field("mediaType", "application/pdf")
			.field("size", String(50 * 1024 * 1024));
		expect(slot.status).toBe(200);
		expect(slot.body.class).toEqual(["upload-slot"]);

		const emitted = [
			...new Set([...namesOf(all.body), ...namesOf(named.body), ...namesOf(saved.body), ...namesOf(slot.body)]),
		].sort();
		expect(marked(root, "data-test-action").sort()).toEqual(emitted);
	});

	it("documents exactly the search fields", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await createAccessToken(harness);
		const root = await readPage(harness);

		const search = actionNamed((await openAll(harness, token)).body, "search");

		expect(marked(root, "data-test-field").sort()).toEqual((search.fields ?? []).map((field) => field.name).sort());
	});

	it("documents exactly the article entity's properties", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await createAccessToken(harness);
		const root = await readPage(harness);
		const saved = await request(harness.server)
			.post(actionNamed((await openAll(harness, token)).body, "save-article").href)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.type("json")
			.send({ url: "https://example.com/property" });
		expect(saved.status).toBe(201);

		const all = await openAll(harness, token);

		expect(marked(root, "data-test-property").sort()).toEqual(Object.keys(all.body.entities[0].properties).sort());
	});

	it("documents every frontmatter key a fully populated article document carries", async () => {
		const summary = createFakeSummaryProvider();
		const harness = useApp({ ...createDefaultTestAppFixture(TEST_APP_ORIGIN), summary });
		const root = await readPage(harness);
		const url = "https://example.com/frontmatter";
		await harness.articleStore.saveArticle({
			userId: UserIdSchema.parse("test-user-123"),
			url,
			metadata: { title: "Hello World", siteName: "example.com", excerpt: "Parsed blurb.", wordCount: 3 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: new Date("2026-09-30T01:02:03.000Z"),
		});
		await harness.articleStore.writeContent({ url, content: "<p>Body copy.</p>" });
		await harness.articleCrawl.markCrawlReady({ url });
		summary.markSummaryReady({ url, summary: "First point.", excerpt: "Generated blurb." });
		const token = await createAccessToken(harness);
		const all = await openAll(harness, token);
		const updateStatus = actionNamed(all.body.entities[0], "update-status");
		const [statusField] = updateStatus.fields ?? [];
		assert(statusField, "update-status must carry its status field");
		const marked303 = await request(harness.server)
			.post(updateStatus.href)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.redirects(0)
			.type("form")
			.send({ [statusField.name]: statusField.value });
		expect(marked303.status).toBe(303);
		const readTab = all.body.properties.tabs.find((tab: { rel: string }) => tab.rel === "tab");
		assert(readTab, "the collection must advertise the other tab");
		const read = await followRedirects(harness, {
			response: await sirenGet(harness, { path: readTab.href, token }),
			token,
		});
		expect(read.status).toBe(200);
		const readLink = read.body.entities[0].links.find((link: { rel: string[] }) => link.rel.includes("read"));
		assert(readLink, "the read article must carry a read link");

		const response = await request(harness.server)
			.get(readLink.href)
			.set("Accept", "text/markdown")
			.set("Authorization", `Bearer ${token}`);

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(marked(root, "data-test-frontmatter").sort()).toEqual(Object.keys(matter(response.text).data).sort());
	});
});

describe("/developers copy", () => {
	it("states each corrected claim word for word", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const root = await readPage(harness);

		const claims = Object.fromEntries(
			Array.from(root.querySelectorAll("[data-test-copy]"), (node) => [
				node.getAttribute("data-test-copy"),
				(node.textContent ?? "").replace(/\s+/g, " ").trim(),
			]),
		);

		expect(claims).toEqual({
			"redirect-rules":
				"Each redirect URI is https, on any host (https://localhost included), or plain http on 127.0.0.1 or [::1]. http://localhost and custom schemes are refused with 400 invalid_redirect_uri.",
			"redirect-uris": "redirect_uris holds 1 to 32 URIs of up to 2,048 characters each.",
			"client-name":
				"client_name is optional and up to 120 characters, and the reader sees it when approving your app. Without it, Readplace names your app after the host of the first redirect URI, without its port.",
			"registration-lifetime":
				"A registration that never gets a token expires after 48 hours. Once it has one, it stays registered until 365 days after its latest token, refreshes included.",
			"exact-redirect":
				"redirect_uri must match a registered URI exactly, port included, so register the exact loopback port your app listens on.",
			scope:
				"Leave out scope. Every token gets full access to the reader's account, and a refresh that sends scope is refused with 400 invalid_scope. The protected resource metadata lists that one access level in scopes_supported as account.",
			"access-token":
				"Access tokens are short-lived. Read expires_in from each token answer, and refresh when a request answers 401 with invalid_token.",
			"refresh-token":
				"Refresh tokens last 180 days and rotate: every refresh returns a new pair and retires the refresh token you sent. Store the new pair before you use it.",
			"refresh-retry": "503 with temporarily_unavailable means try again later with the same refresh token.",
			"app-listing":
				"Connected apps lists your app as AI assistant, connected from the host of your first redirect URI, or from an app on your computer when that URI is on 127.0.0.1 or [::1]. A client_name that matches a supported assistant's name, in any letter case, lists your app as that assistant instead.",
			"create-session":
				"create-session, on every collection, answers 204 with a browser session cookie, for an app that opens Readplace's reader in its own web view. Most integrations skip it. Revoking the token, or the reader signing your app out from all devices, doesn't end a session it made.",
			redirects:
				"Follow every redirect yourself, sending the token and the Accept header again. Some HTTP clients drop Authorization when they follow a redirect, and the API then answers 401.",
			conflict:
				"409: Readplace accepted the save and is still finding the original article behind a wrapper link, such as a redirect or tracking link. The article appears later. Show the message and don't send the save again: each resubmission starts another save.",
			"save-articles":
				"save-articles files every page into All and records each one as a page the reader chose, so send only pages a reader picked.",
			"capture-trigger":
				"Send captureTrigger=automatic with save-content for any capture no reader tapped. A capture sent without it counts as one the reader chose.",
			"upload-slot":
				"A file saved through an upload slot counts as a capture the reader chose, whatever captureTrigger the save-content request sent, so use one only for a file a reader picked.",
			delete:
				"Deleting an article stays in the Readplace app. The API advertises no delete action, and remove-from-readlist takes nothing out of All.",
		});
	});

	it("prints every limit from the constant that enforces it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		expect(marked(await readPage(harness), "data-test-limit")).toEqual([
			"Up to 7 named readlists, besides All.",
			"Readlist names up to 24 characters.",
			"Up to 3 MB per file sent with save-content. A larger file goes through an upload slot.",
			"Up to 500 MB per PDF and 28 MB per HTML page through an upload slot.",
			"Up to 4.5 MB per save-content or save-articles request.",
			"Up to 20 pages per save-articles request, each up to 4.4 MB.",
		]);
	});

	it("names only the advertised content-capture clients", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const root = await readPage(harness);
		const text = root.textContent ?? "";

		const registryTerms = SUPPORTED_CLIENTS.flatMap((client) => [
			client.displayName,
			...(client.auth.kind === "builtIn" ? [client.auth.oauthClientId] : []),
		]);

		expect({
			listed: marked(root, "data-test-client"),
			named: registryTerms.filter((term) => text.includes(term)),
		}).toEqual({ listed: ["Firefox", "Chrome", "iPhone"], named: ["Firefox", "Chrome", "iPhone"] });
	});

	it("links only to sign-up and Connected apps, both tracked", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const hrefs = Array.from((await readPage(harness)).querySelectorAll("a"), (anchor) => anchor.getAttribute("href"));

		expect(hrefs).toEqual([
			"/signup?utm_source=developers&utm_medium=internal&utm_content=signup",
			"/account?utm_source=developers&utm_medium=internal&utm_content=connected-apps#connected-apps",
		]);
	});

	it("prints no path in its prose beyond the entry point, the OAuth endpoints and the login redirect", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const inline = Array.from((await readPage(harness)).querySelectorAll("code"))
			.filter((code) => code.parentElement?.tagName !== "PRE")
			.map((code) => code.textContent ?? "");
		const paths = inline.flatMap((text) => [
			...Array.from(text.matchAll(/(?:^|\s)(\/\S*)/g), (match) => match[1]),
			...(text.includes("readplace.com") ? [text] : []),
		]);

		expect([...new Set(paths)].sort()).toEqual([
			"/",
			"/.well-known/oauth-authorization-server",
			"/.well-known/oauth-protected-resource",
			"/login",
			"/oauth/authorize",
			"/oauth/register",
			"/oauth/revoke",
			"/oauth/token",
		]);
	});

	it("shows each request and answer exactly", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const samples = Object.fromEntries(
			Array.from((await readPage(harness)).querySelectorAll("[data-test-sample]"), (sample) => [
				sample.getAttribute("data-test-sample"),
				sample.textContent,
			]),
		);

		expect(samples).toEqual({
			register: [
				"POST /oauth/register HTTP/1.1",
				"Host: readplace.com",
				"Content-Type: application/json",
				"",
				'{"redirect_uris": ["http://127.0.0.1:8765/callback"], "client_name": "Reading automator"}',
			].join("\n"),
			authorize: [
				"GET /oauth/authorize?response_type=code&client_id=CLIENT_ID&redirect_uri=REDIRECT_URI&code_challenge=CODE_CHALLENGE&code_challenge_method=S256&state=STATE HTTP/1.1",
				"Host: readplace.com",
			].join("\n"),
			token: [
				"POST /oauth/token HTTP/1.1",
				"Host: readplace.com",
				"Content-Type: application/x-www-form-urlencoded",
				"",
				"grant_type=authorization_code&code=AUTH_CODE&redirect_uri=REDIRECT_URI&client_id=CLIENT_ID&code_verifier=CODE_VERIFIER",
			].join("\n"),
			refresh: [
				"POST /oauth/token HTTP/1.1",
				"Host: readplace.com",
				"Content-Type: application/x-www-form-urlencoded",
				"",
				"grant_type=refresh_token&refresh_token=REFRESH_TOKEN&client_id=CLIENT_ID",
			].join("\n"),
			revoke: [
				"POST /oauth/revoke HTTP/1.1",
				"Host: readplace.com",
				"Content-Type: application/json",
				"",
				'{"token": "REFRESH_TOKEN"}',
			].join("\n"),
			discovery: [
				"GET / HTTP/1.1",
				"Host: readplace.com",
				"Authorization: Bearer ACCESS_TOKEN",
				"Accept: application/vnd.siren+json",
			].join("\n"),
			"discovery-answer": ["HTTP/1.1 303 See Other", "Location: COLLECTION_HREF"].join("\n"),
			read: [
				"GET READ_HREF HTTP/1.1",
				"Host: readplace.com",
				"Authorization: Bearer ACCESS_TOKEN",
				"Accept: text/markdown",
			].join("\n"),
			"save-article": [
				"POST SAVE_ARTICLE_HREF HTTP/1.1",
				"Host: readplace.com",
				"Authorization: Bearer ACCESS_TOKEN",
				"Accept: application/vnd.siren+json",
				"Content-Type: application/json",
				"",
				'{"url": "https://example.com/article", "readlists": ["READLIST_HREF"]}',
			].join("\n"),
			"create-readlist": [
				"POST CREATE_READLIST_HREF HTTP/1.1",
				"Host: readplace.com",
				"Authorization: Bearer ACCESS_TOKEN",
				"Accept: application/vnd.siren+json",
				"Content-Type: application/x-www-form-urlencoded",
				"",
				"label=To%20process",
			].join("\n"),
			unauthorized: [
				"HTTP/1.1 401 Unauthorized",
				'WWW-Authenticate: Bearer error="invalid_token", resource_metadata="https://readplace.com/.well-known/oauth-protected-resource"',
			].join("\n"),
		});
	});
});
