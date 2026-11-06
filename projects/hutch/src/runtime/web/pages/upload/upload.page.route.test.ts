import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import { UploadIdSchema, mintPrivateItemUrl } from "@packages/media-contracts";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { BROWSER_REQUEST_HEADERS, useTestServer, loginAgent } from "../../../test-app";

const useApp = useTestServer();
const ONE_DAY_MS = 86_400_000;

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

async function signedIn(fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN)) {
	const harness = useApp(fixture);
	const agent = await loginAgent(harness.server, harness.auth);
	const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
	assert(userId, "seeded login user must exist");
	return { harness, agent, userId, fixture };
}

describe("Upload routes", () => {
	it("renders the presigned form for a signed-out upload", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.post("/upload")
			.type("form")
			.send({ contentType: "application/epub+zip" });
		expect(response.status).toBe(200);
		expect(documentOf(response.text).querySelector("[data-test-upload-s3-form]")).not.toBeNull();
	});

	it("refuses an upload from a read-only account", async () => {
		const { harness, agent, userId } = await signedIn();
		await harness.subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
		});
		const response = await agent.post("/upload").type("form").send({ contentType: "application/epub+zip" });
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?inactive=1");
		expect(harness.mediaUpload.publishedMediaUploadCommitted).toEqual([]);
	});

	it("renders the start form with the EPUB type and no file input", async () => {
		const { agent } = await signedIn();
		const response = await agent.get("/upload");
		expect(response.status).toBe(200);
		const doc = documentOf(response.text);
		const options = [...doc.querySelectorAll('[data-test-upload-start] select[name="contentType"] option')].map(
			(o) => o.getAttribute("value"),
		);
		expect(options).toEqual(["application/epub+zip"]);
		expect(doc.querySelector('[data-test-upload-start] input[type="file"]')).toBeNull();
	});

	it("describes the accepted books without saying their images are not shown", async () => {
		const { agent } = await signedIn();
		const response = await agent.get("/upload");
		const doc = documentOf(response.text);
		expect(doc.querySelector("[data-test-upload-description]")?.textContent).toBe(
			"EPUB, DRM-free, Book: up to 200 MB; MOBI and AZW3 are not supported.",
		);
	});

	it("answers upload_unsupported_type for a type no kind accepts", async () => {
		const { agent } = await signedIn();
		const response = await agent.post("/upload").type("form").send({ contentType: "application/x-mobipocket-ebook" });
		expect(response.status).toBe(422);
		expect(documentOf(response.text).querySelector("[data-test-upload-error]")?.getAttribute("data-test-upload-error")).toBe(
			"upload_unsupported_type",
		);
	});

	it("answers upload_too_large for a declared size over the ceiling", async () => {
		const { agent } = await signedIn();
		const response = await agent
			.post("/upload")
			.type("form")
			.send({ contentType: "application/epub+zip", byteLength: String(201 * 1024 * 1024) });
		expect(response.status).toBe(413);
		expect(documentOf(response.text).querySelector("[data-test-upload-error]")?.getAttribute("data-test-upload-error")).toBe(
			"upload_too_large",
		);
	});

	it("stages a book upload and renders the S3 form with the file input last", async () => {
		const { harness, agent, userId } = await signedIn();
		const response = await agent.post("/upload").type("form").send({ contentType: "application/epub+zip" });
		expect(response.status).toBe(200);
		const doc = documentOf(response.text);
		const form = doc.querySelector<HTMLFormElement>("[data-test-upload-s3-form]");
		assert(form, "the S3 form must render");
		expect(form.getAttribute("action")).toBe(`${TEST_APP_ORIGIN}/e2e/s3-media`);
		const named = [...form.querySelectorAll("[name]")];
		const last = named[named.length - 1];
		expect(last?.getAttribute("name")).toBe("file");
		expect(last?.getAttribute("accept")).toBe(".epub");
		const uploadId = stagedUploadId(doc);
		const session = await harness.mediaUpload.findMediaUploadSession({ uploadId, userId });
		expect(session?.fileName).toBe("Book upload");
		expect(session?.byteLength).toBeUndefined();
	});

	it("keeps a declared file name and size on the session", async () => {
		const { harness, agent, userId } = await signedIn();
		const response = await agent
			.post("/upload")
			.type("form")
			.send({ contentType: "application/epub+zip", fileName: "dune.epub", byteLength: "1024" });
		const session = await harness.mediaUpload.findMediaUploadSession({ uploadId: stagedUploadId(documentOf(response.text)), userId });
		expect(session?.fileName).toBe("dune.epub");
		expect(session?.byteLength).toBe(1024);
	});

	it("commits a received EPUB once and sends the reader to the queue", async () => {
		const { harness, agent, userId } = await signedIn();
		const staged = await agent.post("/upload").type("form").send({ contentType: "application/epub+zip" });
		const uploadId = stagedUploadId(documentOf(staged.text));

		const notYet = await agent.post(`/upload/${uploadId}/received`);
		expect(notYet.status).toBe(409);
		expect(documentOf(notYet.text).querySelector("[data-test-upload-error]")?.getAttribute("data-test-upload-error")).toBe("upload_not_received");

		const landing = await agent.get(`/upload/${uploadId}`);
		expect(landing.status).toBe(200);
		expect(documentOf(landing.text).querySelector("[data-test-upload-continue]")).not.toBeNull();

		harness.mediaUpload.receivePendingOriginal({ uploadId, bytes: epubPrefix() });
		const received = await agent.post(`/upload/${uploadId}/received`);
		expect(received.status).toBe(303);
		expect(received.headers.location).toBe("/queue");

		const session = await harness.mediaUpload.findMediaUploadSession({ uploadId, userId });
		expect(session?.status).toBe("committed");
		expect(harness.mediaUpload.publishedMediaUploadCommitted).toEqual([
			expect.objectContaining({ uploadId, userId, kind: "book", saveAttemptId: session?.saveAttemptId, attempt: 1 }),
		]);

		const again = await agent.get(`/upload/${uploadId}`);
		expect(again.status).toBe(303);
		expect(again.headers.location).toBe("/queue");
	});

	it("answers upload_bad_magic for a received file that is not an EPUB", async () => {
		const { harness, agent } = await signedIn();
		const staged = await agent.post("/upload").type("form").send({ contentType: "application/epub+zip" });
		const uploadId = stagedUploadId(documentOf(staged.text));
		harness.mediaUpload.receivePendingOriginal({ uploadId, bytes: Buffer.from("not a zip at all") });
		const received = await agent.post(`/upload/${uploadId}/received`);
		expect(received.status).toBe(422);
		expect(documentOf(received.text).querySelector("[data-test-upload-error]")?.getAttribute("data-test-upload-error")).toBe("upload_bad_magic");
		expect(harness.mediaUpload.publishedMediaUploadCommitted).toEqual([]);
	});

	it("answers upload_session_not_found for an id the viewer does not own", async () => {
		const { agent } = await signedIn();
		const response = await agent.get("/upload/0123456789abcdef0123456789abcdef");
		expect(response.status).toBe(404);
		expect(documentOf(response.text).querySelector("[data-test-upload-error]")?.getAttribute("data-test-upload-error")).toBe("upload_session_not_found");
	});
	it("tells the owner a failed upload could not be opened", async () => {
		const { harness, agent, fixture } = await signedIn();
		const staged = await agent.post("/upload").type("form").send({ contentType: "application/epub+zip" });
		const uploadId = stagedUploadId(documentOf(staged.text));
		harness.mediaUpload.receivePendingOriginal({ uploadId, bytes: epubPrefix() });
		await agent.post(`/upload/${uploadId}/received`);
		await fixture.mediaUpload.failMediaUpload({ uploadId });

		const response = await agent.get(`/upload/${uploadId}`);
		expect(response.status).toBe(200);
		const notice = documentOf(response.text).querySelector("[data-test-upload-failed] [data-test-alert-variant]");
		expect(notice?.getAttribute("data-test-alert-variant")).toBe("warning");
		expect(notice?.textContent).toContain("We couldn't open that upload.");
	});

	it("refuses an upload and its commit from an unverified account past its verification window", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.shared.now = () => new Date(Date.now() + 8 * ONE_DAY_MS);
		const { harness, agent } = await signedIn(fixture);

		const stage = await agent.post("/upload").type("form").send({ contentType: "application/epub+zip" });
		expect(stage.status).toBe(403);
		expect(documentOf(stage.text).querySelector("h1")?.textContent).toBe("Your account is locked");

		const commit = await agent.post("/upload/0123456789abcdef0123456789abcdef/received");
		expect(commit.status).toBe(403);
		expect(documentOf(commit.text).querySelector("h1")?.textContent).toBe("Your account is locked");
		expect(harness.mediaUpload.publishedMediaUploadCommitted).toEqual([]);
	});

	it("opens the owner's committed book in the reader", async () => {
		const { harness, agent, fixture } = await signedIn();
		const staged = await agent.post("/upload").type("form").send({ contentType: "application/epub+zip" });
		const uploadId = stagedUploadId(documentOf(staged.text));
		harness.mediaUpload.receivePendingOriginal({ uploadId, bytes: epubPrefix() });
		expect((await agent.post(`/upload/${uploadId}/received`)).status).toBe(303);

		const url = mintPrivateItemUrl(uploadId);
		await fixture.articleStore.writeMetadata({
			url,
			metadata: { title: "Dune", siteName: "Book", excerpt: "A desert planet.", wordCount: 139_200 },
			estimatedReadTime: MinutesSchema.parse(580),
		});
		await fixture.articleStore.writeContent({ url, content: '<h2 id="section-1">One</h2><p>Arrakis.</p>' });
		await fixture.articleCrawl.markCrawlReady({ url });

		const response = await agent.get(`/queue/${ReaderArticleHashId.from(url).value}/view`).set(BROWSER_REQUEST_HEADERS);
		expect(response.status).toBe(200);
		const doc = documentOf(response.text);
		expect(doc.querySelector("[data-test-reader-title]")?.textContent?.trim()).toBe("Dune");
		expect(doc.querySelector("[data-test-reader-content]")?.textContent).toContain("Arrakis.");
	});
});
