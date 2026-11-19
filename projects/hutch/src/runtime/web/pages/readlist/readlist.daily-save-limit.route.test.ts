import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { loginAgent, useTestServer, type TestAppHarness } from "../../../test-app";

const useApp = useTestServer();
const useMeteredApp = useTestServer({ isDailyLimited: () => true });

const DAILY_LIMIT_MESSAGE = "You've reached today's limit for new saves. Links you already saved still open.";
const FORM_LIMIT_MESSAGE = "You've reached today's limit for new saves.";
const VALID_HTML = Buffer.from("<html><body>Hello world</body></html>");
const VALID_PDF = Buffer.concat([Buffer.from("%PDF-1.4"), Buffer.alloc(64, 0x20)]);
const UPLOAD_ATTEMPT = "a5d68419-dc83-4f6c-84a9-67e6808acb57";

function fixtureWithDailyLimit(limit: number) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	fixture.rateLimit = {
		...fixture.rateLimit,
		rules: { ...fixture.rateLimit.rules, dailySaves: { limit, windowSeconds: 86_400 } },
	};
	return fixture;
}

async function signedInReader(harness: TestAppHarness) {
	const agent = await loginAgent(harness.server, harness.auth);
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "the logged-in reader must exist");
	const client = await harness.oauthModel.getClient("hutch-firefox-extension", "");
	assert(client, "the oauth client must exist");
	const token = await harness.oauthModel.saveToken(
		{
			accessToken: "daily-limit-access-token",
			accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
			refreshToken: "daily-limit-refresh-token",
			refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3_600_000),
			client,
			user: { id: user.userId },
		},
		client,
		{ id: user.userId },
	);
	assert(token, "the token must be saved");
	return { agent, userId: user.userId, accessToken: token.accessToken };
}

function sirenPost(harness: TestAppHarness, accessToken: string, path: string) {
	return request(harness.server)
		.post(path)
		.set("Accept", SIREN_MEDIA_TYPE)
		.set("Authorization", `Bearer ${accessToken}`);
}

async function isSaved(harness: TestAppHarness, input: { userId: UserId; url: string }): Promise<boolean> {
	const saved = await harness.articleStore.findSavedUrls({ userId: input.userId, urls: [input.url] });
	return saved.length === 1;
}

function saveErrorText(html: string): string | undefined {
	const error = new JSDOM(html).window.document.querySelector("[data-test-save-error]");
	assert(error, "the page shows a save error");
	return error.textContent?.trim();
}

function newUrls(count: number): string[] {
	return Array.from({ length: count }, (_value, index) => `https://example.com/daily-${index}`);
}

describe("daily new-save limit on the save routes", () => {
	describe("POST /queue (save-article)", () => {
		it("saves a metered account's new link while the day's allowance lasts", async () => {
			const harness = useMeteredApp(fixtureWithDailyLimit(1));
			const { accessToken, userId } = await signedInReader(harness);

			const response = await sirenPost(harness, accessToken, "/queue").send({ url: "https://example.com/first" });

			expect(response.status).toBe(201);
			assert.equal(await isSaved(harness, { userId, url: "https://example.com/first" }), true);
		});

		it("refuses a metered account's next new link with a 429 daily_save_limit Siren error", async () => {
			const harness = useMeteredApp(fixtureWithDailyLimit(1));
			const { accessToken, userId } = await signedInReader(harness);
			await sirenPost(harness, accessToken, "/queue").send({ url: "https://example.com/first" });

			const response = await sirenPost(harness, accessToken, "/queue").send({ url: "https://example.com/second" });

			expect(response.status).toBe(429);
			expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
			assert.equal(response.body.properties.code, "daily_save_limit");
			assert.equal(response.body.properties.message, DAILY_LIMIT_MESSAGE);
			assert.equal(await isSaved(harness, { userId, url: "https://example.com/second" }), false);
			expect(harness.analytics.events).toContainEqual(
				expect.objectContaining({ event: "save_refused", code: "daily_save_limit", status: 429 }),
			);
		});

		it("never charges a link the metered account already holds", async () => {
			const harness = useMeteredApp(fixtureWithDailyLimit(1));
			const { accessToken } = await signedInReader(harness);
			await sirenPost(harness, accessToken, "/queue").send({ url: "https://example.com/first" });

			const response = await sirenPost(harness, accessToken, "/queue").send({ url: "https://example.com/first" });

			expect(response.status).toBe(201);
		});

		it("does not count a full-access account's saves", async () => {
			const harness = useApp(fixtureWithDailyLimit(0));
			const { accessToken } = await signedInReader(harness);

			const response = await sirenPost(harness, accessToken, "/queue").send({ url: "https://example.com/first" });

			expect(response.status).toBe(201);
		});
	});

	describe("POST /queue/save-articles", () => {
		function bulkSave(harness: TestAppHarness, input: { accessToken: string; urls: readonly string[] }) {
			return sirenPost(harness, input.accessToken, "/queue/save-articles").field(
				"manifest",
				JSON.stringify(input.urls.map((url) => ({ url }))),
			);
		}

		it("saves 28 of 30 new links sent in two chunks from a metered account and skips the rest as daily_save_limit", async () => {
			const harness = useMeteredApp(fixtureWithDailyLimit(28));
			const { accessToken } = await signedInReader(harness);
			const urls = newUrls(30);
			const first = await bulkSave(harness, { accessToken, urls: urls.slice(0, 20) });
			assert.equal(first.body.properties.saved, 20);

			const response = await bulkSave(harness, { accessToken, urls: urls.slice(20) });

			expect(response.status).toBe(200);
			assert.equal(response.body.properties.saved, 8);
			assert.equal(response.body.properties.skipped, 2);
			assert.deepEqual(response.body.properties.skippedUrls, [
				{ url: urls[28], code: "daily_save_limit", message: DAILY_LIMIT_MESSAGE },
				{ url: urls[29], code: "daily_save_limit", message: DAILY_LIMIT_MESSAGE },
			]);
			assert.deepEqual(response.body.properties.results[9], { url: urls[29], outcome: "skipped", code: "daily_save_limit" });
		});

		it("answers 429 when none of a metered account's new links fit", async () => {
			const harness = useMeteredApp(fixtureWithDailyLimit(0));
			const { accessToken } = await signedInReader(harness);

			const response = await bulkSave(harness, { accessToken, urls: newUrls(2) });

			expect(response.status).toBe(429);
			assert.equal(response.body.properties.code, "daily_save_limit");
		});

		it("does not count a full-access account's saves", async () => {
			const harness = useApp(fixtureWithDailyLimit(0));
			const { accessToken } = await signedInReader(harness);

			const response = await bulkSave(harness, { accessToken, urls: newUrls(2) });

			expect(response.status).toBe(200);
			assert.equal(response.body.properties.saved, 2);
		});
	});

	describe("POST /queue/save-content", () => {
		it("refuses inline content from a metered account whose new saves are spent with a 429 and a Retry-After", async () => {
			const harness = useMeteredApp(fixtureWithDailyLimit(0));
			const { accessToken, userId } = await signedInReader(harness);

			const response = await sirenPost(harness, accessToken, "/queue/save-content")
				.field("url", "https://example.com/captured")
				.field("mediaType", "text/html")
				.attach("content", VALID_HTML, { filename: "page.html", contentType: "text/html" });

			expect(response.status).toBe(429);
			expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
			assert.equal(response.body.properties.code, "daily_save_limit");
			assert.equal(response.body.properties.message, DAILY_LIMIT_MESSAGE);
			assert.equal(await isSaved(harness, { userId, url: "https://example.com/captured" }), false);
			expect(harness.analytics.events).toContainEqual(
				expect.objectContaining({ event: "save_refused", code: "daily_save_limit" }),
			);
		});

		it("refuses an upload slot to a metered account whose new saves are spent with a 429 and a Retry-After", async () => {
			const harness = useMeteredApp(fixtureWithDailyLimit(0));
			const { accessToken } = await signedInReader(harness);

			const response = await sirenPost(harness, accessToken, "/queue/save-content")
				.field("url", "https://example.com/big.pdf")
				.field("mediaType", "application/pdf")
				.field("size", "1000");

			expect(response.status).toBe(429);
			expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
			assert.equal(response.body.properties.code, "daily_save_limit");
		});

		it("completes an upload without claiming again, so a spent day still finishes it", async () => {
			const harness = useMeteredApp(fixtureWithDailyLimit(0));
			const { accessToken } = await signedInReader(harness);
			const url = "https://example.com/big.pdf";
			await harness.pendingUpload.stageUploaded({ saveAttemptId: UPLOAD_ATTEMPT, url, mediaType: "application/pdf", bytes: VALID_PDF });

			const response = await sirenPost(harness, accessToken, "/queue/save-content")
				.field("url", url)
				.field("mediaType", "application/pdf")
				.field("saveAttemptId", UPLOAD_ATTEMPT)
				.field("uploaded", "true");

			expect(response.status).toBe(201);
		});
	});

	describe("POST /queue/save (the add-link form)", () => {
		it("returns a metered reader to the queue with the daily-limit error", async () => {
			const harness = useMeteredApp(fixtureWithDailyLimit(0));
			const { agent, userId } = await signedInReader(harness);

			const response = await agent.post("/queue/save").type("form").send({ url: "https://example.com/form" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toContain("error_code=daily_save_limit");
			assert.equal(await isSaved(harness, { userId, url: "https://example.com/form" }), false);
			const queue = await agent.get(response.headers.location);
			expect(saveErrorText(queue.text)).toContain(FORM_LIMIT_MESSAGE);
		});

		it("re-renders the dialog form with the daily-limit error", async () => {
			const harness = useMeteredApp(fixtureWithDailyLimit(0));
			const { agent } = await signedInReader(harness);

			const response = await agent
				.post("/queue/save")
				.set("HX-Request", "true")
				.type("form")
				.send({ url: "https://example.com/form" });

			expect(response.status).toBe(422);
			expect(saveErrorText(response.text)).toBe(FORM_LIMIT_MESSAGE);
		});
	});
});
