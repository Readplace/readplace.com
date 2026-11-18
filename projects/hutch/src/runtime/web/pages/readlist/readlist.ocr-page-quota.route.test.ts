import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { loginAgent, useTestServer, type TestAppHarness } from "../../../test-app";

const useApp = useTestServer();
const useMeteredApp = useTestServer({ isDailyLimited: () => true });

const OCR_QUOTA_MESSAGE = "You've used today's PDF page allowance. Try again tomorrow, or start a trial for no daily limit.";
const VALID_HTML = Buffer.from("<html><body>Hello world</body></html>");
const VALID_PDF = Buffer.concat([Buffer.from("%PDF-1.4"), Buffer.alloc(64, 0x20)]);
const UPLOAD_ATTEMPT = "a5d68419-dc83-4f6c-84a9-67e6808acb57";

function fixtureWithOcrPagesLeft(pagesLeft: number) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const stagedPdfs: string[] = [];
	const putPendingPdf = fixture.pendingPdf.putPendingPdf;
	fixture.pendingPdf = {
		...fixture.pendingPdf,
		putPendingPdf: async (params) => {
			stagedPdfs.push(params.url);
			await putPendingPdf(params);
		},
	};
	const claimedSaveUnits: number[] = [];
	const claimRateLimitUnits = fixture.rateLimit.claimRateLimitUnits;
	fixture.rateLimit = {
		...fixture.rateLimit,
		readOcrPagesLeft: async () => pagesLeft,
		claimRateLimitUnits: async (claim) => {
			claimedSaveUnits.push(claim.requested);
			return claimRateLimitUnits(claim);
		},
	};
	return { fixture, stagedPdfs, claimedSaveUnits };
}

async function signedInReader(harness: TestAppHarness) {
	await loginAgent(harness.server, harness.auth);
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "the logged-in reader must exist");
	const client = await harness.oauthModel.getClient("hutch-firefox-extension", "");
	assert(client, "the oauth client must exist");
	const token = await harness.oauthModel.saveToken(
		{
			accessToken: "ocr-quota-access-token",
			accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
			refreshToken: "ocr-quota-refresh-token",
			refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3_600_000),
			client,
			user: { id: user.userId },
		},
		client,
		{ id: user.userId },
	);
	assert(token, "the token must be saved");
	return { userId: user.userId, accessToken: token.accessToken };
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

describe("daily OCR page allowance on the save routes", () => {
	describe("POST /queue/save-content", () => {
		it("refuses an inline PDF from a metered account with no pages left with a 429 ocr-page-quota error and stages nothing", async () => {
			const { fixture, stagedPdfs, claimedSaveUnits } = fixtureWithOcrPagesLeft(0);
			const harness = useMeteredApp(fixture);
			const { accessToken, userId } = await signedInReader(harness);

			const response = await sirenPost(harness, accessToken, "/queue/save-content")
				.field("url", "https://example.com/paper.pdf")
				.field("mediaType", "application/pdf")
				.attach("content", VALID_PDF, { filename: "paper.pdf", contentType: "application/pdf" });

			expect(response.status).toBe(429);
			assert.equal(response.body.properties.code, "ocr-page-quota");
			assert.equal(response.body.properties.message, OCR_QUOTA_MESSAGE);
			assert.deepEqual(stagedPdfs, []);
			assert.deepEqual(claimedSaveUnits, [], "a refused PDF must not spend a daily save");
			assert.equal(await isSaved(harness, { userId, url: "https://example.com/paper.pdf" }), false);
		});

		it("saves inline HTML from a metered account with no pages left", async () => {
			const { fixture } = fixtureWithOcrPagesLeft(0);
			const harness = useMeteredApp(fixture);
			const { accessToken } = await signedInReader(harness);

			const response = await sirenPost(harness, accessToken, "/queue/save-content")
				.field("url", "https://example.com/captured")
				.field("mediaType", "text/html")
				.attach("content", VALID_HTML, { filename: "page.html", contentType: "text/html" });

			expect(response.status).toBe(201);
		});

		it("stages an inline PDF from a metered account with a page left", async () => {
			const { fixture, stagedPdfs } = fixtureWithOcrPagesLeft(1);
			const harness = useMeteredApp(fixture);
			const { accessToken } = await signedInReader(harness);

			const response = await sirenPost(harness, accessToken, "/queue/save-content")
				.field("url", "https://example.com/paper.pdf")
				.field("mediaType", "application/pdf")
				.attach("content", VALID_PDF, { filename: "paper.pdf", contentType: "application/pdf" });

			expect(response.status).toBe(201);
			assert.deepEqual(stagedPdfs, ["https://example.com/paper.pdf"]);
		});

		it("stages an inline PDF from a full-access account whatever its page counter says", async () => {
			const { fixture, stagedPdfs } = fixtureWithOcrPagesLeft(0);
			const harness = useApp(fixture);
			const { accessToken } = await signedInReader(harness);

			const response = await sirenPost(harness, accessToken, "/queue/save-content")
				.field("url", "https://example.com/paper.pdf")
				.field("mediaType", "application/pdf")
				.attach("content", VALID_PDF, { filename: "paper.pdf", contentType: "application/pdf" });

			expect(response.status).toBe(201);
			assert.deepEqual(stagedPdfs, ["https://example.com/paper.pdf"]);
		});

		it("refuses a PDF upload slot to a metered account with no pages left", async () => {
			const { fixture, claimedSaveUnits } = fixtureWithOcrPagesLeft(0);
			const harness = useMeteredApp(fixture);
			const { accessToken } = await signedInReader(harness);

			const response = await sirenPost(harness, accessToken, "/queue/save-content")
				.field("url", "https://example.com/big.pdf")
				.field("mediaType", "application/pdf")
				.field("size", "1000");

			expect(response.status).toBe(429);
			assert.equal(response.body.properties.code, "ocr-page-quota");
			assert.deepEqual(claimedSaveUnits, [], "a refused PDF must not spend a daily save");
		});

		it("refuses to complete a PDF upload for a metered account with no pages left", async () => {
			const { fixture } = fixtureWithOcrPagesLeft(0);
			const harness = useMeteredApp(fixture);
			const { accessToken, userId } = await signedInReader(harness);
			const url = "https://example.com/big.pdf";
			await harness.pendingUpload.stageUploaded({ saveAttemptId: UPLOAD_ATTEMPT, url, mediaType: "application/pdf", bytes: VALID_PDF });

			const response = await sirenPost(harness, accessToken, "/queue/save-content")
				.field("url", url)
				.field("mediaType", "application/pdf")
				.field("saveAttemptId", UPLOAD_ATTEMPT)
				.field("uploaded", "true");

			expect(response.status).toBe(429);
			assert.equal(response.body.properties.code, "ocr-page-quota");
			assert.equal(await isSaved(harness, { userId, url }), false);
		});
	});

	describe("POST /queue/save-articles", () => {
		it("skips a metered account's PDF tab as ocr-page-quota and saves its other tabs", async () => {
			const { fixture, stagedPdfs, claimedSaveUnits } = fixtureWithOcrPagesLeft(0);
			const harness = useMeteredApp(fixture);
			const { accessToken, userId } = await signedInReader(harness);
			const pdfUrl = "https://example.com/paper.pdf";
			const htmlUrl = "https://example.com/article";

			const response = await sirenPost(harness, accessToken, "/queue/save-articles")
				.field("manifest", JSON.stringify([{ url: pdfUrl, mediaType: "application/pdf" }, { url: htmlUrl, mediaType: "text/html" }]))
				.attach("content-0", VALID_PDF, { filename: "paper.pdf", contentType: "application/pdf" })
				.attach("content-1", VALID_HTML, { filename: "page.html", contentType: "text/html" });

			expect(response.status).toBe(200);
			assert.equal(response.body.properties.saved, 1);
			assert.deepEqual(response.body.properties.skippedUrls, [{ url: pdfUrl, code: "ocr-page-quota", message: OCR_QUOTA_MESSAGE }]);
			assert.deepEqual(response.body.properties.results[0], { url: pdfUrl, outcome: "skipped", code: "ocr-page-quota" });
			assert.deepEqual(stagedPdfs, []);
			assert.deepEqual(claimedSaveUnits, [1], "only the HTML tab spends a daily save");
			assert.equal(await isSaved(harness, { userId, url: htmlUrl }), true);
		});

		it("stages a metered account's PDF tab while it has pages left", async () => {
			const { fixture, stagedPdfs } = fixtureWithOcrPagesLeft(5);
			const harness = useMeteredApp(fixture);
			const { accessToken } = await signedInReader(harness);
			const pdfUrl = "https://example.com/paper.pdf";

			const response = await sirenPost(harness, accessToken, "/queue/save-articles")
				.field("manifest", JSON.stringify([{ url: pdfUrl, mediaType: "application/pdf" }]))
				.attach("content-0", VALID_PDF, { filename: "paper.pdf", contentType: "application/pdf" });

			expect(response.status).toBe(200);
			assert.equal(response.body.properties.saved, 1);
			assert.deepEqual(stagedPdfs, [pdfUrl]);
		});
	});

	describe("GET /queue/:id/view", () => {
		it("shows the saver the held notice while the held PDF's crawl is pending", async () => {
			const { fixture } = fixtureWithOcrPagesLeft(5);
			const harness = useMeteredApp(fixture);
			const { accessToken, userId } = await signedInReader(harness);
			const agent = await loginAgent(harness.server, harness.auth);
			const url = "https://example.com/paper.pdf";
			const saved = await sirenPost(harness, accessToken, "/queue/save-content")
				.field("url", url)
				.field("mediaType", "application/pdf")
				.attach("content", VALID_PDF, { filename: "paper.pdf", contentType: "application/pdf" });
			assert.equal(saved.status, 201);
			await harness.articleCrawl.forceMarkCrawlPending({ url });
			await harness.articleStore.markOcrPagesHeld({ userId, url, hold: { pages: 40, pagesLeft: 5, retryAt: new Date("2026-11-16T03:00:00.000Z") } });

			const response = await agent.get(`/queue/${saved.body.properties.id}/view`);

			expect(response.status).toBe(200);
			const notice = new JSDOM(response.text).window.document.querySelector("[data-test-reader-notice]");
			assert(notice, "the reader renders a notice");
			assert.equal(notice.getAttribute("data-reader-status"), "ocr-pages-held");
			expect(notice.textContent).toContain("This file has 40 pages and your free account has 5 pages left today");
		});
	});
});
