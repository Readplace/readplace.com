import assert from "node:assert/strict";
import type { Server } from "node:http";
import { JSDOM } from "jsdom";
import request from "supertest";
import { MediaUploadStagedEvent, INSPECT_BOOK_TIMEOUT_SECONDS } from "@packages/infra-components";
import { UploadIdSchema } from "@packages/media-contracts";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { describeUntrackedCtas, findUntrackedCtas } from "@packages/web-test-harness";
import { initInMemoryRateLimit } from "@packages/test-fixtures/providers/rate-limit";
import { loginAgent, useTestServer } from "../../../test-app";
import { inspectionPollBudget } from "./inspection-poll-budget";

const useApp = useTestServer();
const ONE_DAY_MS = 86_400_000;
const MAX_POLLS = inspectionPollBudget({ lambdaTimeoutSeconds: INSPECT_BOOK_TIMEOUT_SECONDS, marginSeconds: 30 });
const PROCESSING_EXHAUSTED_NOTICE = "We couldn't open this book. Upload it again.";
const BOOK_FACTS = {
	kind: "book" as const,
	title: "A Guest Book",
	authors: ["Ada Author", "Bo Writer"],
	sectionTitles: ["One", "Two", "Three"],
};

function epubPrefix(): Uint8Array {
	const bytes = Buffer.alloc(64);
	Buffer.from([0x50, 0x4b, 0x03, 0x04]).copy(bytes, 0);
	Buffer.from("mimetypeapplication/epub+zip").copy(bytes, 30);
	return bytes;
}

function documentOf(html: string): Document {
	return new JSDOM(html).window.document;
}

function stagedUploadId(doc: Document): ReturnType<typeof UploadIdSchema.parse> {
	const key = doc.querySelector<HTMLInputElement>('[data-test-upload-s3-form] input[name="key"]')?.value;
	assert(key, "the S3 form must carry the object key");
	return UploadIdSchema.parse(key.replace("pending/", "").replace("/original", ""));
}

function statusOf(html: string): Element {
	const status = documentOf(html).querySelector("#upload-status");
	assert(status, "every review view renders #upload-status");
	return status;
}

function urlOf(href: string | null | undefined): URL {
	assert(href, "the link must carry a target");
	return new URL(href, TEST_APP_ORIGIN);
}

function guestApp(fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN)) {
	return useApp(fixture);
}

type Harness = ReturnType<typeof guestApp>;

function mp3Prefix(): Uint8Array {
	return Buffer.from("ID3\x04\x00\x00\x00\x00\x00\x00", "latin1");
}

async function guestStage(server: Server, body: Record<string, string> = {}) {
	const staged = await request(server).post("/upload").type("form").send(body);
	return stagedUploadId(documentOf(staged.text));
}

async function guestReceive(harness: Harness, body?: Record<string, string>) {
	const uploadId = await guestStage(harness.server, body);
	harness.mediaUpload.receivePendingOriginal({ uploadId, bytes: epubPrefix() });
	const head = await harness.mediaUpload.headMediaPendingOriginal({ uploadId });
	assert(head, "the staged original must be there");
	const received = await request(harness.server).post(`/upload/${uploadId}/received`);
	return { uploadId, head, received };
}

async function guestReady(harness: Harness, body?: Record<string, string>) {
	const staged = await guestReceive(harness, body);
	await harness.mediaUpload.recordMediaInspection({
		uploadId: staged.uploadId,
		inspection: { verdict: "inspected", facts: BOOK_FACTS },
	});
	return staged;
}

async function readerB(harness: Harness) {
	await harness.auth.createUser({ email: "b@example.com", password: "password123" });
	const agent = request.agent(harness.server).set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/145.0.0.0");
	await agent.post("/login").type("form").send({ email: "b@example.com", password: "password123" });
	return agent;
}

describe("Guest upload routes", () => {
	it("stages a guest EPUB on a session without an owner and renders the presigned form", async () => {
		const harness = guestApp();
		const response = await request(harness.server)
			.post("/upload")
			.type("form")
			.send({});

		expect(response.status).toBe(200);
		const uploadId = stagedUploadId(documentOf(response.text));
		const session = await harness.mediaUpload.findMediaUploadByCapability({ uploadId, userId: undefined });
		expect(session?.userId).toBeUndefined();
		expect(session?.status).toBe("staged");
	});

	it("refuses a guest's audio upload, naming only the formats a guest may upload", async () => {
		const harness = guestApp();
		const uploadId = await guestStage(harness.server);
		harness.mediaUpload.receivePendingOriginal({
			uploadId,
			bytes: mp3Prefix(),
		});
		const received = await request(harness.server).post(
			`/upload/${uploadId}/received`,
		);

		expect(received.status).toBe(422);
		const error = documentOf(received.text).querySelector(
			"[data-test-upload-error]",
		);
		expect(error?.getAttribute("data-test-upload-error")).toBe(
			"upload_unsupported_type",
		);
		expect(error?.textContent).toContain(
			"That file type isn't supported. Upload a DRM-free EPUB.",
		);
		expect(harness.mediaUpload.publishedMediaUploadStaged).toEqual([]);
	});

	it("keeps a signed-in upload on the member path without spending the guest allowance", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.rateLimit = {
			consumeRateLimit: initInMemoryRateLimit({ now: () => new Date() }).consumeRateLimit,
			rules: { ...fixture.rateLimit.rules, uploadStage: { limit: 1, windowSeconds: 3600 } },
		};
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const staged = await agent.post("/upload").type("form").send({});
		const uploadId = stagedUploadId(documentOf(staged.text));
		harness.mediaUpload.receivePendingOriginal({ uploadId, bytes: epubPrefix() });
		const received = await agent.post(`/upload/${uploadId}/received`);

		expect(received.headers.location).toBe("/queue");
		expect(harness.mediaUpload.publishedMediaUploadCommitted).toHaveLength(1);
		expect(harness.mediaUpload.publishedMediaUploadStaged).toEqual([]);
		const guest = await request(harness.server)
			.post("/upload")
			.type("form")
			.send({});
		expect(guest.status).toBe(200);
	});

	it("stages a received guest upload for review once and publishes what the HEAD saw", async () => {
		const harness = guestApp();
		const { uploadId, head, received } = await guestReceive(harness);

		expect(received.status).toBe(303);
		expect(received.headers.location).toBe(`/upload/${uploadId}`);
		expect(harness.mediaUpload.publishedMediaUploadStaged).toHaveLength(1);
		const detail = MediaUploadStagedEvent.detailSchema.parse(harness.mediaUpload.publishedMediaUploadStaged[0]);
		expect(detail).toEqual(
			expect.objectContaining({ uploadId, size: head.size, etag: head.etag, mediaType: "application/epub+zip", kind: "book" }),
		);

		const again = await request(harness.server).post(`/upload/${uploadId}/received`);
		expect(again.status).toBe(303);
		expect(again.headers.location).toBe(`/upload/${uploadId}`);
		expect(harness.mediaUpload.publishedMediaUploadStaged).toHaveLength(1);
	});

	it("sends a Siren client to the review once a received guest upload is staged", async () => {
		const harness = guestApp();
		const uploadId = await guestStage(harness.server);
		harness.mediaUpload.receivePendingOriginal({ uploadId, bytes: epubPrefix() });

		const received = await request(harness.server)
			.post(`/upload/${uploadId}/received`)
			.set("Accept", "application/vnd.siren+json");

		expect(received.status).toBe(303);
		expect(received.headers.location).toBe(`/upload/${uploadId}`);
	});

	it("stages a guest row for review when a signed-in reader holding its id posts received", async () => {
		const harness = guestApp();
		const uploadId = await guestStage(harness.server);
		harness.mediaUpload.receivePendingOriginal({ uploadId, bytes: epubPrefix() });
		const agent = await loginAgent(harness.server, harness.auth);
		const received = await agent.post(`/upload/${uploadId}/received`);

		expect(received.headers.location).toBe(`/upload/${uploadId}`);
		const session = await harness.mediaUpload.findMediaUploadByCapability({ uploadId, userId: undefined });
		expect(session?.status).toBe("inspecting");
		expect(harness.mediaUpload.publishedMediaUploadStaged).toHaveLength(1);
	});

	it("answers upload_session_not_found for a guest received of an unparseable id", async () => {
		const harness = guestApp();
		const response = await request(harness.server).post("/upload/not-an-id/received");

		expect(documentOf(response.text).querySelector("[data-test-upload-error]")?.getAttribute("data-test-upload-error")).toBe(
			"upload_session_not_found",
		);
		expect(harness.mediaUpload.publishedMediaUploadStaged).toEqual([]);
	});

	it("shows the guest the Continue form on the S3 redirect without indexing it", async () => {
		const harness = guestApp();
		const uploadId = await guestStage(harness.server);
		const response = await request(harness.server).get(`/upload/${uploadId}`);

		expect(documentOf(response.text).querySelector("[data-test-upload-continue]")).not.toBeNull();
		expect(response.headers["x-robots-tag"]).toBe("noindex");
	});

	it("polls an inspecting upload with a tracked Check again link and publishes nothing", async () => {
		const harness = guestApp();
		const { uploadId } = await guestReceive(harness);
		const before = harness.mediaUpload.publishedMediaUploadStaged.length;
		const response = await request(harness.server).get(`/upload/${uploadId}`);

		const status = statusOf(response.text);
		expect(status.getAttribute("data-upload-status")).toBe("inspecting");
		expect(status.hasAttribute("data-test-upload-inspecting")).toBe(true);
		expect(status.getAttribute("hx-select")).toBe("#upload-status");
		expect(status.getAttribute("hx-get")).toBe(`/upload/${uploadId}?poll=1`);
		const checkAgain = urlOf(status.querySelector("[data-test-upload-check-again]")?.getAttribute("href"));
		expect(checkAgain.pathname).toBe(`/upload/${uploadId}`);
		expect(checkAgain.searchParams.get("poll")).toBe("1");
		expect(checkAgain.searchParams.get("utm_source")).toBe("upload-review");
		expect(checkAgain.searchParams.get("utm_content")).toBe("check-again");
		expect(harness.mediaUpload.publishedMediaUploadStaged.length).toBe(before);
		expect(harness.mediaUpload.publishedMediaUploadCommitted).toEqual([]);
	});

	it("counts the poll forward", async () => {
		const harness = guestApp();
		const { uploadId } = await guestReceive(harness);
		const response = await request(harness.server).get(`/upload/${uploadId}?poll=2`);

		expect(statusOf(response.text).getAttribute("hx-get")).toBe(`/upload/${uploadId}?poll=3`);
	});

	it("shows the inspected book with a chapter list and a tracked commit form", async () => {
		const harness = guestApp();
		const { uploadId } = await guestReady(harness);
		const response = await request(harness.server).get(`/upload/${uploadId}?poll=1`);

		const status = statusOf(response.text);
		expect(status.getAttribute("data-upload-status")).toBe("review");
		const review = status.querySelector("[data-test-upload-review]");
		assert(review, "the review view holds the book's facts");
		expect(review.querySelector("[data-test-upload-review-title]")?.textContent).toBe("A Guest Book");
		expect(review.querySelector("[data-test-upload-review-authors]")?.textContent).toBe("Ada Author, Bo Writer");
		expect([...review.querySelectorAll("[data-test-upload-section]")].map((s) => s.textContent)).toEqual(["One", "Two", "Three"]);
		const action = urlOf(review.querySelector("[data-test-upload-commit-form]")?.getAttribute("action"));
		expect(action.pathname).toBe(`/upload/${uploadId}/commit`);
		expect(action.searchParams.get("utm_source")).toBe("upload-review");
		expect(action.searchParams.get("utm_content")).toBe("commit");
	});

	it("ends a spent poll budget in its own overrun outcome", async () => {
		const harness = guestApp();
		const { uploadId } = await guestReceive(harness);
		const response = await request(harness.server).get(`/upload/${uploadId}?poll=${MAX_POLLS + 1}`);

		const status = statusOf(response.text);
		expect(status.getAttribute("data-upload-status")).toBe("overrun");
		expect(status.getAttributeNames()).toEqual(["id", "data-upload-status"]);
		expect(status.querySelector("[data-test-upload-inspection-overrun]")).not.toBeNull();
		const again = urlOf(status.querySelector("[data-test-upload-again]")?.getAttribute("href"));
		expect(again.pathname).toBe("/upload");
		expect(again.searchParams.get("utm_source")).toBe("upload-review");
		expect(again.searchParams.get("utm_content")).toBe("upload-again");
	});

	it("shows a rejected book's notice inside the poll budget, not the overrun", async () => {
		const harness = guestApp();
		const { uploadId } = await guestReceive(harness);
		await harness.mediaUpload.recordMediaInspection({
			uploadId,
			inspection: { verdict: "rejected", reason: "processing-exhausted", notice: PROCESSING_EXHAUSTED_NOTICE },
		});
		const response = await request(harness.server).get(`/upload/${uploadId}?poll=${MAX_POLLS - 1}`);

		const status = statusOf(response.text);
		expect(status.getAttribute("data-upload-status")).toBe("rejected");
		expect(status.querySelector("[data-test-upload-notice]")?.textContent).toBe(PROCESSING_EXHAUSTED_NOTICE);
		const again = urlOf(status.querySelector("[data-test-upload-again]")?.getAttribute("href"));
		expect(again.pathname).toBe("/upload");
		expect(again.searchParams.get("utm_content")).toBe("upload-again");
	});

	it("tracks every CTA and keeps every review view out of search", async () => {
		const harness = guestApp();
		const inspecting = await guestReceive(harness);
		const ready = await guestReady(harness);
		const rejected = await guestReceive(harness);
		await harness.mediaUpload.recordMediaInspection({
			uploadId: rejected.uploadId,
			inspection: { verdict: "rejected", reason: "unreadable", notice: "This book is protected by DRM." },
		});
		const paths = [
			`/upload/${inspecting.uploadId}`,
			`/upload/${inspecting.uploadId}?poll=${MAX_POLLS + 1}`,
			`/upload/${ready.uploadId}`,
			`/upload/${rejected.uploadId}`,
		];

		for (const path of paths) {
			const response = await request(harness.server).get(path);
			expect(describeUntrackedCtas(findUntrackedCtas(response.text, { skipSelectors: [], ownOrigin: TEST_APP_ORIGIN }))).toEqual([]);
			expect(documentOf(response.text).querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
			expect(response.headers["x-robots-tag"]).toBe("noindex");
		}
	});

	it("tells a guest at /upload they can sign up when they save", async () => {
		const harness = guestApp();
		const response = await request(harness.server).get("/upload");

		const doc = documentOf(response.text);
		expect(doc.querySelector("[data-upload-viewer]")?.getAttribute("data-upload-viewer")).toBe("guest");
		expect(doc.querySelector("[data-test-upload-guest-notice]")?.textContent).toBe("You can upload now and sign up when you save it.");
	});

	it("names a signed-in reader at /upload a member", async () => {
		const harness = guestApp();
		const agent = await loginAgent(harness.server, harness.auth);
		const response = await agent.get("/upload");

		expect(documentOf(response.text).querySelector("[data-upload-viewer]")?.getAttribute("data-upload-viewer")).toBe("member");
	});

	it("sends an anonymous commit to signup with a return to the review", async () => {
		const harness = guestApp();
		const { uploadId } = await guestReady(harness);
		const response = await request(harness.server).post(`/upload/${uploadId}/commit`);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/signup?return=%2Fupload%2F${uploadId}`);
	});

	it("sends an anonymous commit of an unparseable id to a bare signup", async () => {
		const harness = guestApp();
		const response = await request(harness.server).post("/upload/not-an-id/commit");

		expect(response.headers.location).toBe("/signup");
	});

	it("refuses a commit from a locked account", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.shared.now = () => new Date(Date.now() + 8 * ONE_DAY_MS);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const response = await agent.post("/upload/0123456789abcdef0123456789abcdef/commit");

		expect(response.status).toBe(403);
		expect(documentOf(response.text).querySelector("h1")?.textContent).toBe("Your account is locked");
	});

	it("refuses a commit from a read-only account", async () => {
		const harness = guestApp();
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		await harness.subscriptionProviders.upsertTrialing({ userId, trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString() });
		const response = await agent.post("/upload/0123456789abcdef0123456789abcdef/commit");

		expect(response.headers.location).toBe("/queue?inactive=1");
	});

	it("answers upload_session_not_found for a commit of an id that is not there", async () => {
		const harness = guestApp();
		const agent = await loginAgent(harness.server, harness.auth);
		const response = await agent.post("/upload/not-an-id/commit");

		expect(documentOf(response.text).querySelector("[data-test-upload-error]")?.getAttribute("data-test-upload-error")).toBe(
			"upload_session_not_found",
		);
	});

	it("saves the reviewed book after signup once, under the guest's attempt and the staged etag", async () => {
		const harness = guestApp();
		const { uploadId, head } = await guestReady(harness, { byteLength: "64" });
		const guestSession = await harness.mediaUpload.findMediaUploadByCapability({
			uploadId,
			userId: undefined,
		});
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;

		const commit = await agent.post(`/upload/${uploadId}/commit`);
		expect(commit.status).toBe(303);
		expect(commit.headers.location).toBe("/queue");
		expect(harness.mediaUpload.publishedMediaUploadCommitted).toEqual([
			expect.objectContaining({ uploadId, userId, etag: head.etag, saveAttemptId: guestSession?.saveAttemptId }),
		]);

		const again = await agent.post(`/upload/${uploadId}/commit`);
		expect(again.headers.location).toBe("/queue");
		expect(harness.mediaUpload.publishedMediaUploadCommitted).toHaveLength(1);
	});

	it("keeps a claimed upload from a second reader", async () => {
		const harness = guestApp();
		const { uploadId } = await guestReady(harness);
		const readerA = await loginAgent(harness.server, harness.auth);
		await readerA.post(`/upload/${uploadId}/commit`);
		const agentB = await readerB(harness);

		const view = await agentB.get(`/upload/${uploadId}`);
		expect(documentOf(view.text).querySelector("[data-test-upload-error]")?.getAttribute("data-test-upload-error")).toBe(
			"upload_session_not_found",
		);
		const commit = await agentB.post(`/upload/${uploadId}/commit`);
		expect(documentOf(commit.text).querySelector("[data-test-upload-error]")?.getAttribute("data-test-upload-error")).toBe(
			"upload_session_not_found",
		);
		expect(harness.mediaUpload.publishedMediaUploadCommitted).toHaveLength(1);
		const queue = await agentB.get("/queue");
		expect(documentOf(queue.text).querySelector("[data-test-empty-readlist]")).not.toBeNull();
	});

	it("refuses a second reader's commit of a review the first has not yet saved", async () => {
		const harness = guestApp();
		const { uploadId } = await guestReceive(harness);
		const agentB = await readerB(harness);
		const commit = await agentB.post(`/upload/${uploadId}/commit`);

		expect(documentOf(commit.text).querySelector("[data-test-upload-error]")?.getAttribute("data-test-upload-error")).toBe(
			"upload_session_not_found",
		);
	});

	it("limits one IP to ten guest uploads an hour", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.rateLimit = {
			consumeRateLimit: initInMemoryRateLimit({ now: () => new Date() }).consumeRateLimit,
			rules: { ...fixture.rateLimit.rules, uploadStage: { limit: 20, windowSeconds: 3600 } },
		};
		const harness = useApp(fixture);
		for (let upload = 0; upload < 10; upload++) await guestReceive(harness);

		const eleventh = await request(harness.server)
			.post("/upload")
			.type("form")
			.send({});
		expect(eleventh.status).toBe(429);
	});
});
