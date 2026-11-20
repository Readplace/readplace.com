import assert from "node:assert/strict";
import request from "supertest";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture, type TestAppFixture } from "@packages/test-fixtures";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { loginAgent, useTestServer, type TestAppHarness } from "../../../test-app";

const useApp = useTestServer();
const MINE = ReadlistSlugSchema.parse("mine");
const CAPTURED_PAGE = Buffer.from("<html><body><p>A page the reader captured.</p></body></html>");

async function readerWithOwnSaves(harness: TestAppHarness) {
	await loginAgent(harness.server, harness.auth);
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "the logged-in reader must exist");
	const userId = user.userId;
	await harness.articleStore.createReadlistDefinition({ userId, slug: MINE, label: "Mine", createdAt: new Date() });
	await harness.articleStore.setReadlistOwnSaves({ userId, slug: MINE, since: new Date() });
	return userId;
}

async function bearerFor(input: { harness: TestAppHarness; userId: UserId; clientId: string }): Promise<string> {
	const client = await input.harness.oauthModel.getClient(input.clientId, "");
	assert(client, "the oauth client must exist");
	const token = await input.harness.oauthModel.saveToken(
		{
			accessToken: `own-saves-${input.clientId}`,
			accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
			refreshToken: `own-saves-refresh-${input.clientId}`,
			refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3_600_000),
			client,
			user: { id: input.userId },
		},
		client,
		{ id: input.userId },
	);
	assert(token, "the token must be saved");
	return token.accessToken;
}

const TRACKER = "https://javascriptweekly.com/link/100000/rss";

function queuedReadlists(fixture: TestAppFixture) {
	return fixture.submitLink.submitLinks.map((link) => link.readlist);
}

async function savedReadlists(input: { harness: TestAppHarness; userId: UserId; url: string }) {
	const saves = await input.harness.articleStore.listUserSavesForUrl({ userId: input.userId, url: input.url });
	return saves.map((save) => save.readlist).sort();
}

describe("the own-saves readlist", () => {
	it("files an extension's save into the own-saves readlist and names it in the confirmation", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const userId = await readerWithOwnSaves(harness);
		const accessToken = await bearerFor({ harness, userId, clientId: "hutch-firefox-extension" });
		const url = "https://example.com/own-save";

		const response = await request(harness.server).post("/queue").set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`).send({ url });

		expect(response.status).toBe(201);
		expect(JSON.stringify(response.body)).toContain("Saved to 'All' and 'Mine'");
		expect(await savedReadlists({ harness, userId, url })).toContain(MINE);
	});

	it("does not file an app's save into the own-saves readlist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const userId = await readerWithOwnSaves(harness);
		const accessToken = await bearerFor({ harness, userId, clientId: "ios-app" });
		const url = "https://example.com/app-save";

		const response = await request(harness.server).post("/queue").set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`).send({ url });

		expect(response.status).toBe(201);
		expect(await savedReadlists({ harness, userId, url })).not.toContain(MINE);
	});

	it("files a tapped capture into the own-saves readlist and leaves an automatic one out", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const userId = await readerWithOwnSaves(harness);
		const accessToken = await bearerFor({ harness, userId, clientId: "hutch-firefox-extension" });
		const capture = (input: { url: string; captureTrigger: string }) =>
			request(harness.server).post("/queue/save-content").set("Accept", SIREN_MEDIA_TYPE)
				.set("Authorization", `Bearer ${accessToken}`)
				.field("url", input.url).field("mediaType", "text/html").field("captureTrigger", input.captureTrigger)
				.attach("content", CAPTURED_PAGE, "content");

		const tapped = await capture({ url: "https://example.com/tapped", captureTrigger: "manual" });
		const automatic = await capture({ url: "https://example.com/automatic", captureTrigger: "automatic" });

		expect(tapped.status).toBe(201);
		expect(automatic.status).toBe(201);
		expect(await savedReadlists({ harness, userId, url: "https://example.com/tapped" })).toContain(MINE);
		expect(await savedReadlists({ harness, userId, url: "https://example.com/automatic" })).not.toContain(MINE);
	});

	it("queues an unresolved extension save for the own-saves readlist with the same save attempt", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const userId = await readerWithOwnSaves(harness);
		const accessToken = await bearerFor({ harness, userId, clientId: "hutch-firefox-extension" });

		const response = await request(harness.server).post("/queue").set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`).send({ url: TRACKER });

		expect(response.status).toBe(409);
		expect(queuedReadlists(fixture)).toEqual(["default", MINE]);
		expect(new Set(fixture.submitLink.submitLinks.map((link) => link.saveAttemptId)).size).toBe(1);
	});

	it("files a save addressed to the own-saves readlist into it once", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const userId = await readerWithOwnSaves(harness);
		const accessToken = await bearerFor({ harness, userId, clientId: "hutch-firefox-extension" });
		const url = "https://example.com/addressed-own-save";

		const response = await request(harness.server).post(`/queue?readlist=${MINE}`).set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`).send({ url });

		expect(response.status).toBe(201);
		expect(JSON.stringify(response.body).split("'Mine'")).toHaveLength(2);
		expect(await savedReadlists({ harness, userId, url })).toContain(MINE);
	});

	it("queues an unresolved tapped capture for the own-saves readlist", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const userId = await readerWithOwnSaves(harness);
		const accessToken = await bearerFor({ harness, userId, clientId: "hutch-firefox-extension" });

		await request(harness.server).post("/queue/save-content").set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", TRACKER).field("mediaType", "text/html").field("captureTrigger", "manual")
			.attach("content", CAPTURED_PAGE, "content");

		expect(queuedReadlists(fixture)).toEqual(["default", MINE]);
	});

	it("files a save from the readlist's save bar into the own-saves readlist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const userId = await readerWithOwnSaves(harness);
		const agent = await loginAgent(harness.server, harness.auth);
		const url = "https://example.com/save-bar";

		const response = await agent.post("/queue/save").type("form").send({ url });

		expect(response.status).toBe(303);
		expect(await savedReadlists({ harness, userId, url })).toContain(MINE);
	});

	it("queues an unresolved save from the readlist's save bar for the own-saves readlist", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		await readerWithOwnSaves(harness);
		const agent = await loginAgent(harness.server, harness.auth);

		await agent.post("/queue/save").type("form").send({ url: TRACKER });

		expect(queuedReadlists(fixture)).toEqual(["default", MINE]);
	});

	it("files each page of a Save All Tabs press into the own-saves readlist and queues an unresolved one for it", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const userId = await readerWithOwnSaves(harness);
		const accessToken = await bearerFor({ harness, userId, clientId: "hutch-firefox-extension" });
		const url = "https://example.com/tab";

		const response = await request(harness.server).post("/queue/save-articles").set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", JSON.stringify([{ url }, { url: TRACKER }]));

		expect(response.status).toBe(200);
		expect(await savedReadlists({ harness, userId, url })).toContain(MINE);
		expect(queuedReadlists(fixture)).toEqual(["default", MINE]);
	});
});

