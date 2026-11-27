import assert from "node:assert/strict";
import matter from "gray-matter";
import { JSDOM } from "jsdom";
import request from "supertest";
import { SAMPLE_TEXT, discover, saveArticle } from "@packages/api-samples";
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
	assert.equal(entry.status, 200, "the entry point must answer with the collection");
	return entry;
}

interface Action {
	name: string;
	href: string;
	fields?: { name: string; type?: string; value?: string }[];
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

async function readPage(harness: Harness, query = ""): Promise<Element> {
	return pageRoot((await request(harness.server).get(`/developers${query}`)).text);
}

function loopbackOrigin(harness: Harness): string {
	const address = harness.server.address();
	assert(address !== null && typeof address === "object", "the test server must listen on a TCP address");
	return `http://127.0.0.1:${address.port}`;
}

function sampleTexts(root: Element): Record<string, string | null> {
	return Object.fromEntries(
		Array.from(root.querySelectorAll("[data-test-sample]"), (sample) => [
			sample.getAttribute("data-test-sample"),
			sample.textContent,
		]),
	);
}

function sampleCode(root: Element, name: string): Element {
	const code = root.querySelector(`[data-test-sample="${name}"] code`);
	assert(code, `the ${name} sample must render`);
	return code;
}

function currentTab(root: Element): string | null | undefined {
	return root.querySelector('[data-test-language][aria-current="page"]')?.getAttribute("data-test-language");
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
			"uploads",
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

	it.each([
		["typescript", SAMPLE_TEXT.typescript],
		["swift", SAMPLE_TEXT.swift],
	])("returns the %s samples as their own fences beside the other http ones", async (language, text) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const html = (await request(harness.server).get(`/developers?l=${language}`)).text;

		const response = await request(harness.server).get(`/developers?l=${language}`).set("Accept", "text/markdown");

		expect(response.text.split("\n")[0]).toBe("# Build on the Readplace API — Readplace");
		expect(response.text.split("```http\n").length - 1).toBe(9);
		expect(response.text.split(`\`\`\`${language}\n`).length - 1).toBe(2);
		expect(response.text).toContain(`\`\`\`${language}\n${text.discover}\n\`\`\``);
		expect(response.text).toContain(`\`\`\`${language}\n${text.saveArticle}\n\`\`\``);
		expect(response.text).not.toContain("<script");
		expect(response.text).not.toMatch(/\bCopy\b/);
		expect(pageRoot(html).querySelectorAll("button")).toHaveLength(0);
	});
});

describe("/developers sample languages", () => {
	it.each(["", "?l=http", "?l=ruby"])("shows the HTTP samples for %p", async (query) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const root = await readPage(harness, query);

		expect(currentTab(root)).toBe("http");
		expect(sampleCode(root, "discovery").textContent).toBe(
			[
				"GET / HTTP/1.1",
				"Host: readplace.com",
				"Authorization: Bearer ACCESS_TOKEN",
				`Accept: ${SIREN_MEDIA_TYPE}`,
			].join("\n"),
		);
		expect(sampleCode(root, "discovery").className).toBe("language-http");
	});

	it.each([
		["typescript", SAMPLE_TEXT.typescript],
		["swift", SAMPLE_TEXT.swift],
	])("swaps the discovery and save samples for %s and keeps the rest", async (language, text) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const defaults = sampleTexts(await readPage(harness));

		const root = await readPage(harness, `?l=${language}`);

		expect(currentTab(root)).toBe(language);
		expect(sampleCode(root, "discovery").textContent).toBe(text.discover);
		expect(sampleCode(root, "save-article").textContent).toBe(text.saveArticle);
		expect([sampleCode(root, "discovery").className, sampleCode(root, "save-article").className]).toEqual([
			`language-${language}`,
			`language-${language}`,
		]);
		expect({
			...sampleTexts(root),
			discovery: null,
			"save-article": null,
		}).toEqual({
			...defaults,
			discovery: null,
			"save-article": null,
		});
	});
});

describe("/developers on-this-page navigation", () => {
	it("names every link after the heading it leads to", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const root = await readPage(harness);

		const links = Array.from(root.querySelectorAll("[data-test-page-nav] a"), (link) => {
			const target = root.querySelector(String(link.getAttribute("href")));
			return [link.textContent, target?.querySelector("h2, h3")?.textContent];
		});

		expect(links.length).toBe(18);
		for (const [linkText, headingText] of links) {
			expect(headingText).toBe(linkText);
		}
	});

	it("links each top-level entry to a section", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const root = await readPage(harness);

		const topLevel = Array.from(root.querySelectorAll("[data-test-page-nav] .developers__nav-list > li > a"), (link) =>
			String(link.getAttribute("href")).slice(1),
		);

		expect(topLevel).toEqual(
			Array.from(root.querySelectorAll("[data-test-section]"), (section) => section.getAttribute("data-test-section")),
		);
	});
});

describe("code samples run against the API", () => {
	it("discovers the collection and saves a link", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await createAccessToken(harness);
		const origin = loopbackOrigin(harness);

		const collection = await discover({ origin, token });
		const saved = await saveArticle({
			origin,
			token,
			collection,
			url: "https://example.com/sample",
		});

		expect(saved.class).toEqual(["article"]);
		expect(saved.properties.url).toBe("https://example.com/sample");
		const all = await openAll(harness, token);
		expect(all.body.entities.map((entity: { properties: { url: string } }) => entity.properties.url)).toContain(
			"https://example.com/sample",
		);
	});

	it("files the saved link into the readlists it names", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await createAccessToken(harness);
		const origin = loopbackOrigin(harness);
		const created = await request(harness.server)
			.post(actionNamed((await openAll(harness, token)).body, "create-readlist").href)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.type("form")
			.send({ label: "Samples" })
			.redirects(0);
		expect(created.status).toBe(303);
		const readlist = (await openAll(harness, token)).body.properties.readlists.find(
			(entry: { label: string }) => entry.label === "Samples",
		);
		assert(readlist, "the created readlist must be advertised");

		await saveArticle({
			origin,
			token,
			collection: await discover({ origin, token }),
			url: "https://example.com/sample",
			readlists: [readlist.href],
		});

		const named = await followRedirects(harness, {
			response: await sirenGet(harness, { path: readlist.href, token }),
			token,
		});
		expect(named.body.entities.map((entity: { properties: { url: string } }) => entity.properties.url)).toEqual([
			"https://example.com/sample",
		]);
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
		const pinned = await request(harness.server)
			.post(actionNamed(named.body, "pin-readlist").href)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.type("form")
			.send({})
			.redirects(0);
		expect(pinned.status).toBe(303);
		const namedPinned = await sirenGet(harness, { path: pinned.headers.location, token });
		expect(namedPinned.status).toBe(200);
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
		const uploadLink = all.body.links.find((link: { rel: string[] }) => link.rel.includes("upload"));
		assert(uploadLink, "the collection must link to the upload entry");
		const uploadEntry = await sirenGet(harness, { path: uploadLink.href, token });
		expect(uploadEntry.body.class).toEqual(["upload"]);
		expect(actionNamed(all.body, "stage-upload")).toEqual(actionNamed(uploadEntry.body, "stage-upload"));
		const staged = await request(harness.server)
			.post(actionNamed(uploadEntry.body, "stage-upload").href)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.type("form")
			.send({ fileName: "dune.epub", byteLength: "1024" });
		expect(staged.body.class).toEqual(["upload-staged"]);

		const emitted = [
			...new Set([
				...namesOf(all.body),
				...namesOf(named.body),
				...namesOf(namedPinned.body),
				...namesOf(saved.body),
				...namesOf(slot.body),
				...namesOf(uploadEntry.body),
				...namesOf(staged.body),
			]),
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

	it("documents exactly the find-articles fields a client fills in", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await createAccessToken(harness);
		const root = await readPage(harness);

		const findArticles = actionNamed((await openAll(harness, token)).body, "find-articles");
		const filledIn = (findArticles.fields ?? []).filter((field) => field.type !== "hidden").map((field) => field.name);

		expect(marked(root, "data-test-find-articles-field").sort()).toEqual(filledIn.sort());
	});

	it("documents every property an article entity carries", async () => {
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

		const emitted = new Set([...Object.keys(saved.body.properties), ...Object.keys(all.body.entities[0].properties)]);
		expect(marked(root, "data-test-property")).toEqual(expect.arrayContaining([...emitted]));
	});

	it("documents every frontmatter key a fully populated article document carries", async () => {
		const summary = createFakeSummaryProvider({ findItemOwner: async () => undefined });
		const harness = useApp({ ...createDefaultTestAppFixture(TEST_APP_ORIGIN), summary });
		const root = await readPage(harness);
		const url = "https://example.com/frontmatter";
		await harness.articleStore.saveArticle({
			userId: UserIdSchema.parse("test-user-123"),
			url,
			metadata: { title: "Hello World", siteName: "example.com", excerpt: "Parsed blurb.", wordCount: 3, publishedOn: "2026-09-29" },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: new Date("2026-09-30T01:02:03.000Z"),
			saveTrigger: "manual",
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
				"create-session, on every collection, answers 204 with a browser session cookie, for an app that opens Readplace's reader in its own web view. This session can open the Readplace inbox and read imported and forwarded message bodies. The token can read saved newsletter issues and summaries. Disconnecting Gmail preserves these copies and your app grant. Disconnecting through Connected apps can leave an existing browser session signed in. Revoking a self-registered app's token also leaves its session signed in. Clear its cookie from your web view when disconnected. A password change or reset does end it.",
			"report-age-range":
				"report-age-range, on every collection, is how Readplace's own apps pass on the age range a device's app store reports for its user. It answers 204, or 403 when that user may not use Readplace. Integrators skip it.",
			"entry-point": "It answers 200 with the reader's collection, not a redirect:",
			"read-from-answers":
				"Hard-code only /, the two media types, the action names you use, what the fields you fill in mean, the link rels you follow, and the frontmatter keys you read. Read everything else from the answers: every href, method, type and field list. Encode each body as the action's type says, and build it from the action's fields rather than a hard-coded encoding.",
			"stale-href":
				"If a request to an href or action you kept fails with anything other than a 401, 403 or 422 refusal, such as a 404 or 405, drop your copy, start again from / and retry once.",
			classes:
				"An entity's class says what it is: collection and articles on a collection, article on an article, error on a refusal and on a 409, save-articles-result on a save-articles answer, upload-slot on an upload slot, and upload and upload-staged on the upload entry and a staged upload.",
			"past-last": "A page past the last answers 200 with no entities, a prev link and no next link.",
			"offline-prefetch":
				"A next link can carry a class of offline-prefetch. It tells Readplace's own apps how to load that page while they download a readlist for offline reading, so ignore it.",
			rels: "Links use the IANA rel where one exists, such as self, next and prev. original is Memento's. read, upload-again, root, account, add-links-help and upload are Readplace's own.",
			"article-self":
				"Each article entity also carries a self link with no title: the article's own address. Fetch it to get that article alone.",
			"article-original":
				"An article whose source is public also carries an original link of type text/html, with no title: the page it came from, to open in a browser without the token. An uploaded file or other private item has none, even though its url is set. An upload Readplace couldn't use carries an untitled upload-again link of type text/html to the signed-in upload page, until the next version of the article drops it. Show each only while it's present.",
			"hand-picked":
				"Every article a reader saves themselves joins Hand Picked, including each page sent through save-articles. Imports and newsletter links stay in “All” only. The home link opens Hand Picked, or the readlist the reader chose as home when the request sends X-Readplace-Home-Readlist: 1. properties.browseReadlists lists Hand Picked first, then “All” and each named readlist. The add-to-hand-picked and remove-from-hand-picked actions are gone: a reader adds an older article with “Add to readlist” on the web and removes one from the Hand Picked readlist there.",
			storefront:
				"A client installed from an app store may send its storefront's three-letter code in an X-Readplace-Storefront header, or in a readplace_storefront cookie from a web view. For China mainland (CHN), responses leave out text a model wrote: summaries, Next read and Already read.",
			"markdown-layout":
				"After the frontmatter comes the summary as a callout, > [!summary] Summary (TL;DR) with the summary quoted beneath it, then the article as Markdown. The callout is there only when readplace_summary_status is ready, and the article is empty until readplace_content_status is ready.",
			highlights:
				"When the reader has highlighted the article, the document ends with a ## Highlights section: each highlight as a quote, followed by the reader's note when there is one. A quote whose passage changed in the current version ends with (edited in the current version; you highlighted “…”), and one whose passage is gone ends with (not found in the current version).",
			created:
				"201: the saved article, with messages to show and a collection link, and a Location header with the same address as the article's self link. Saving a link again answers 201 too, with a message that it was already saved.",
			conflict:
				"409: Readplace accepted the save and is still finding the original article behind a wrapper link, such as a redirect or tracking link. It isn't a failure, though the body is an entity of class error: its one warning message says the link is queued. The article appears later. Show the message and don't send the save again: each resubmission starts another save.",
			"save-articles-parts":
				"Name each page's part content- followed by the page's index in the manifest, counting from 0, such as content-0. The action's content field names that family of parts and gives each part's maxBytes.",
			"save-articles-link-only":
				"A page is saved as a link alone, and still counts as created or merged, when its part is missing, its mediaType isn't HTML or PDF, its bytes say PDF without a PDF header, or its URL isn't an article, such as a webmail page.",
			"save-articles-result":
				"The 200 answer is an entity of class save-articles-result. saved, queued, skipped and failed count pages, where saved includes the queued ones. skippedUrls lists each skipped page as {url, code, message}, and tooBig is always an empty list. results holds a {url, outcome, code} for each manifest entry, in manifest order. outcome is created, merged, skipped or failed. code is queued on a page Readplace is still resolving behind a wrapper link, or says why a page was skipped: unsupported_scheme, private_network, malformed_url or private_item.",
			"save-articles":
				"save-articles files every page into All and records each one as a page the reader chose, so send only pages a reader picked.",
			"capture-trigger":
				"captureTrigger is automatic or manual, and any other value answers 422 invalid-save-content with the message captureTrigger must be automatic or manual. Send automatic for any capture no reader tapped: Readplace weighs it like a copy it fetched itself, so it can be set aside as unreadable. manual, or no captureTrigger, counts as a capture the reader chose, which Readplace keeps when it's the article's first content.",
			"save-content-link-only":
				"When content holds the bytes, a mediaType other than HTML or PDF, a URL that isn't an article, or a PDF without a PDF header doesn't refuse the save: it answers 201 and saves the link alone.",
			"upload-window":
				"The slot answers 200. Submit save-uploaded-content within 30 minutes of finishing the upload: after that it answers 422 upload-not-found, and you start again with a new slot. A size request for a wrapper link whose original article Readplace can't find yet answers 422 original-unresolved, where sending the bytes in content would answer 409.",
			"upload-slot":
				"A file saved through an upload slot counts as a capture the reader chose, whatever captureTrigger the save-content request sent, so use one only for a file a reader picked.",
			"save-content-refusals":
				"A refused save-content answers 422 with an error entity and a fallback save-article action that saves the link alone. The codes are invalid-save-content, capture-not-allowed, unsupported-media-type, content-too-large, original-unresolved, upload-not-found and not-a-pdf, which save-uploaded-content answers when the uploaded file isn't a PDF. capture-not-allowed, for a URL that isn't an article, and unsupported-media-type come only from a request that sends size or completes an upload. With the bytes in content, the same cases answer 201 and save the link alone.",
			redirects:
				"Follow every redirect yourself, sending the token and the Accept header again. Some HTTP clients drop Authorization when they follow a redirect, and the API then answers 401.",
			"field-limits":
				"Each action also states its limits in its fields, as maxItems, maxBytes and maxRequestBytes, Readplace's own additions to Siren's fields. Read them from the answer rather than hard-coding these numbers.",
			"find-articles":
				"find-articles searches and filters the readlist and tab you're on. Send every hidden field with its value, and fill in these:",
			"home-readlist":
				"Send X-Readplace-Home-Readlist: 1 on every request to follow the reader's chosen home through the home link. The set-home-readlist action is for Readplace's own apps, so integrators skip it.",
			vary: "A collection, and the 303 that moves an older collection href to its current form, answer Vary: Accept, Authorization, User-Agent, X-Readplace-Client, X-Readplace-Save-Continuity, X-Readplace-Home-Readlist. Key any copy you keep on the token and the Accept header too, so one reader's collection is never served for another's token.",
			delete:
				"Deleting an article stays in the Readplace app. The API advertises no delete action, and remove-from-readlist takes nothing out of All.",
			"walkthrough-entry": "Request / with the token and the Siren media type. It answers with the collection.",
			"upload-link":
				"Every collection carries an upload link with no title. Follow it with the token to reach the upload entry, which keeps a file only the reader can open, not a page at a URL.",
			"upload-entry":
				"The entry is an entity of class upload. properties.kinds lists the kinds of file this reader can upload, each with its name (book, audio or video), a description to show, accepts (each media type with its file extensions), uploadCeilingBytes and ceilingLabel. heading and transcriptAllowance are text to show as given.",
			"stage-upload":
				"stage-upload: send its fields, fileName and the file's size in bytes as byteLength. It answers 200 with an entity of class upload-staged, a self link to this upload's status, and two actions. The collection offers the same action.",
			"upload-content-multipart":
				"upload-content here is a multipart POST: send every field it lists with the value it carries, then the file in the file field, last. Storage answers 201. The same action name on an upload slot is a PUT, so follow each action's own method, type and fields.",
			"confirm-received":
				"confirm-received: submit it once storage has answered. It answers 303 to the reader's collection, where the file appears.",
			"upload-status":
				"If your app stops between steps, fetch the self link you kept. While the file is still to be confirmed it answers upload-staged again, with confirm-received. Once the file is saved it answers 303 to the collection, and when Readplace can't open the file it answers 422 upload_failed.",
			"upload-refusals":
				"File and quota refusals carry code, message, and messages. An expired or invalid token answers 401 invalid-token, and a locked account 403. 404 upload_session_not_found means the upload isn't this reader's, or has expired. 409 upload_not_received means storage hasn't got the file yet. 413 upload_too_large means the file is over its kind's uploadCeilingBytes. 422 carries upload_unsupported_type, transcript-quota, transcript-too-long, unreadable-audio, no-audio-track or book-quota, whose retryAt property says when the reader can upload another book.",
		});
	});

	it("states each corrected property, field and action description word for word", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const root = await readPage(harness);
		const itemOf = (attribute: string, name: string) =>
			Array.from(root.querySelectorAll(`[${attribute}]`))
				.filter((code) => code.textContent === name)
				.map((code) => (code.closest("li")?.textContent ?? "").replace(/\s+/g, " ").trim());

		expect({
			pages: itemOf("data-test-collection-property", "pages"),
			readlists: itemOf("data-test-collection-property", "readlists"),
			hint: itemOf("data-test-collection-property", "hint"),
			status: itemOf("data-test-field", "status"),
			order: itemOf("data-test-field", "order"),
			url: itemOf("data-test-field", "url"),
			readTime: itemOf("data-test-property", "readTime"),
			sectionCount: itemOf("data-test-property", "sectionCount"),
			processing: itemOf("data-test-property", "processing"),
		}).toEqual({
			pages: [
				"pages: one {label, rel, href} per page, where the page you're on has the rel current, every earlier page prev and every later page next. An empty tab lists page 1 as current. The next and prev links step one page at a time, and the self link is the page you're on.",
			],
			readlists: [
				"readlists: All and each named readlist, each a {label, rel, href, pinned}. Follow an href to open that readlist, or send it in a save's readlists field. For Readplace's own apps only, the current entry may also carry preferences on a named readlist or integrations on All, each a {label, href} to a signed-in settings page. Show that control only when it's there, and never build its URL yourself.",
			],
			hint: [
				"hint: for Readplace's own apps only, on the Hand Picked collection: a {text, link: {label, href}} note the app shows with its link. Skip it.",
			],
			status: ["status: unread or read. Without it, search lists unread articles."],
			order: [
				"order: asc or desc. Unread articles sort by when they were saved and read ones by when they were read. Without it, the newest come first.",
			],
			url: [
				"url: keeps only the article saved under that URL, if it's on the page you asked for. total and pages then count only that match, so the answer has one page and no next.",
			],
			readTime: [
				"readTime: {value, label}, where value is the minutes as a string and label is display text such as 5 min read. On an article with audio, the minutes are its listening time and label reads like 12 min listen. It's null when Readplace has no word count for an article without audio.",
			],
			sectionCount: ["sectionCount: present on an uploaded EPUB book: how many sections it has."],
			processing: [
				"processing: present only while Readplace is still working on the article. label is display text, estimate is an optional time left, an object whose kind is quiet, with seconds left and revealInSeconds before a countdown is worth showing, counting, with seconds left, or almost-there, with nothing more. refresh gives the href to fetch after afterSeconds for the article's next version. When the next version has no processing, the work has settled or Readplace has stopped waiting, and a messages warning may say why.",
			],
		});
		expect(marked(root, "data-test-action")).toEqual(expect.arrayContaining(["update-status"]));
		expect(root.querySelector('[data-test-section="status"]')?.textContent?.replace(/\s+/g, " ")).toContain(
			"update-status has one hidden field, status,",
		);
		expect(root.querySelector('[data-test-section="saving"]')?.textContent?.replace(/\s+/g, " ")).toContain(
			"(invalid-save-articles), the manifest lists more than",
		);
		expect(
			Array.from(root.querySelectorAll('[data-test-section="saving"] code'), (code) => code.textContent).filter((text) =>
				text?.startsWith("save-articles-too"),
			),
		).toEqual(["save-articles-too-many-pages", "save-articles-too-large"]);
	});

	it("no longer claims the entry point redirects", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const root = await readPage(harness);
		const text = (root.textContent ?? "").replace(/\s+/g, " ");
		const discovery = root.querySelector('[data-test-section="discovery"]')?.textContent ?? "";

		expect(text).not.toContain("redirect from /");
		expect(text).not.toContain("follow the 303 to the collection");
		expect(discovery).not.toMatch(/Follow every redirect/);
	});

	it("prints every limit from the constant that enforces it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		expect(marked(await readPage(harness), "data-test-limit")).toEqual([
			"Up to 15 named readlists, besides All.",
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
		}).toEqual({ listed: ["Firefox", "Chrome", "iPhone", "Android"], named: ["Firefox", "Chrome", "iPhone", "Android"] });
	});

	it("links only to its own sample tabs and sections, sign-up and Connected apps, all tracked", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const hrefs = Array.from((await readPage(harness)).querySelectorAll("a"), (anchor) => anchor.getAttribute("href"));

		expect(hrefs).toEqual([
			"/developers?utm_source=developers&utm_medium=internal&utm_content=samples-http",
			"/developers?l=typescript&utm_source=developers&utm_medium=internal&utm_content=samples-typescript",
			"/developers?l=swift&utm_source=developers&utm_medium=internal&utm_content=samples-swift",
			"#overview",
			"#authentication",
			"#register",
			"#authorize",
			"#get-tokens",
			"#disconnect",
			"#discovery",
			"#collection",
			"#articles",
			"#saving",
			"#uploads",
			"#status",
			"#readlists",
			"#caching",
			"#errors",
			"#limits",
			"#not-in-the-api",
			"#walkthrough",
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
			"discovery-answer": ["HTTP/1.1 200 OK", "Content-Type: application/vnd.siren+json"].join("\n"),
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
