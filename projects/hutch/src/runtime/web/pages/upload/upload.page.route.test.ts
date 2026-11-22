import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import { UploadIdSchema, mintPrivateItemUrl } from "@packages/media-contracts";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { BROWSER_REQUEST_HEADERS, useTestServer, loginAgent } from "../../../test-app";
import { accountLockedSirenError } from "../../api/account-locked-siren";
import { saveAccessTokenForUser } from "../../test-helpers/oauth-token";
import { UPLOAD_FAILED_MESSAGE, uploadErrorMessageOf } from "./upload.error";
import { isSignedInMediaUploadSession } from "./stage-for-review";

const useApp = useTestServer();
const SIREN = "application/vnd.siren+json";

interface SirenActionBody {
	name: string;
	href: string;
	method: string;
	type?: string;
	fields?: { name: string; type: string; value?: string }[];
}

function actionNamed(body: { actions?: SirenActionBody[] }, name: string): SirenActionBody {
	const action = body.actions?.find((a) => a.name === name);
	assert(action, `the entity must carry a ${name} action`);
	return action;
}
const ONE_DAY_MS = 86_400_000;

function epubPrefix(): Uint8Array {
	const bytes = Buffer.alloc(64);
	Buffer.from([0x50, 0x4b, 0x03, 0x04]).copy(bytes, 0);
	Buffer.from("mimetypeapplication/epub+zip").copy(bytes, 30);
	return bytes;
}

function mp3Prefix(): Uint8Array {
	return Buffer.from("ID3\x04\x00\x00\x00\x00\x00\x00", "latin1");
}

function mp4Prefix(): Uint8Array {
	return Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom", "latin1"), Buffer.alloc(20)]);
}

function errorCodeOf(html: string): string | null | undefined {
	return documentOf(html)
		.querySelector("[data-test-upload-error]")
		?.getAttribute("data-test-upload-error");
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
		const response = await request(harness.server).post("/upload").type("form");
		expect(response.status).toBe(200);
		expect(documentOf(response.text).querySelector("[data-test-upload-s3-form]")).not.toBeNull();
	});

	it("stages an upload for a free-plan account, since uploads are core", async () => {
		const { harness, agent, userId } = await signedIn();
		await harness.subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
		});
		const response = await agent.post("/upload").type("form").send({});
		expect(response.status).toBe(200);
		expect(documentOf(response.text).querySelector("[data-test-upload-s3-form]")).not.toBeNull();
	});

	it("renders the start form for a member with no kind to choose and no file input", async () => {
		const { agent } = await signedIn();
		const response = await agent.get("/upload");
		expect(response.status).toBe(200);
		const doc = documentOf(response.text);
		expect(doc.querySelector("[data-test-upload-start] select")).toBeNull();
		expect(
			doc.querySelector('[data-test-upload-start] input[type="file"]'),
		).toBeNull();
		expect(doc.querySelector("[data-test-upload-heading]")?.textContent).toBe(
			"Upload a book, an audio file, or a video",
		);
		expect(
			[...doc.querySelectorAll("[data-test-upload-description]")].map(
				(p) => p.textContent,
			),
		).toEqual([
			"Book: EPUB, DRM-free, up to 200 MB. MOBI and AZW3 are not supported.",
			"Audio: MP3 or M4A, up to 256 MB.",
			"Video: MP4, up to 2 GB.",
		]);
	});

	it("tells a member who started with the transcripts feature the daily transcript allowance", async () => {
		const { agent } = await signedIn();
		const response = await agent.get("/upload?features=transcripts");
		expect(
			documentOf(response.text).querySelector("[data-test-upload-transcript-allowance]")?.textContent,
		).toBe(
			"Audio and video files get a timestamped transcript, up to 20 minutes a day.",
		);
	});

	it("tells a member without the transcripts feature that audio and video files are transcribed, and a guest that audio files are", async () => {
		const { agent, harness } = await signedIn();
		const member = await agent.get("/upload");
		const guest = await request(harness.server).get("/upload");
		expect(
			[member, guest].map((response) =>
				documentOf(response.text).querySelector("[data-test-upload-transcript-allowance]")?.textContent,
			),
		).toEqual([
			"Audio and video files get a timestamped transcript, up to 20 minutes a day.",
			"Audio files get a timestamped transcript, up to 20 minutes a day.",
		]);
	});

	it("tells a guest on the transcripts feature that audio files are transcribed", async () => {
		const { harness } = await signedIn();
		const response = await request(harness.server).get("/upload?features=transcripts");
		expect(
			documentOf(response.text).querySelector("[data-test-upload-transcript-allowance]")?.textContent,
		).toBe(
			"Audio files get a timestamped transcript, up to 20 minutes a day.",
		);
	});

	it("describes books and audio to a guest", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const doc = documentOf((await request(harness.server).get("/upload")).text);
		expect(doc.querySelector("[data-test-upload-heading]")?.textContent).toBe(
			"Upload a book or an audio file",
		);
		expect(
			[...doc.querySelectorAll("[data-test-upload-description]")].map(
				(p) => p.textContent,
			),
		).toEqual([
			"Book: EPUB, DRM-free, up to 200 MB. MOBI and AZW3 are not supported.",
			"Audio: MP3 or M4A, up to 256 MB.",
		]);
		expect(
			doc.querySelector("[data-test-upload-transcript-allowance]")?.textContent,
		).toBe("Audio files get a timestamped transcript, up to 20 minutes a day.");
	});

	it("accepts EPUB and audio files from a guest", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const doc = documentOf(
			(await request(harness.server).post("/upload").type("form").send({}))
				.text,
		);
		expect(
			doc.querySelector("[data-test-upload-file]")?.getAttribute("accept"),
		).toBe(".epub,.mp3,.m4a");
		expect(
			[...doc.querySelectorAll("[data-test-upload-staged-description]")].map(
				(p) => p.textContent,
			),
		).toEqual([
			"Book: EPUB, DRM-free, up to 200 MB. MOBI and AZW3 are not supported.",
			"Audio: MP3 or M4A, up to 256 MB.",
		]);
	});

	it("refuses a guest's declared size over the audio ceiling", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.post("/upload")
			.type("form")
			.send({ byteLength: String(257 * 1024 * 1024) });
		expect(response.status).toBe(413);
		expect(errorCodeOf(response.text)).toBe("upload_too_large");
	});

	it("ignores a declared size that is not a positive whole number", async () => {
		const { harness, agent, userId } = await signedIn();
		const response = await agent
			.post("/upload")
			.type("form")
			.send({ fileName: "dune.epub", byteLength: "lots" });
		expect(response.status).toBe(200);
		const session = await harness.mediaUpload.findMediaUploadSession({
			uploadId: stagedUploadId(documentOf(response.text)),
			userId,
		});
		expect(session?.fileName).toBeUndefined();
		expect(session?.byteLength).toBeUndefined();
	});

	it("answers upload_too_large for a declared size over every kind's ceiling", async () => {
		const { agent } = await signedIn();
		const response = await agent
			.post("/upload")
			.type("form")
			.send({ byteLength: String(2 * 1024 * 1024 * 1024 + 1) });
		expect(response.status).toBe(413);
		expect(documentOf(response.text).querySelector("[data-test-upload-error]")?.getAttribute("data-test-upload-error")).toBe(
			"upload_too_large",
		);
	});

	it("stages an upload and renders the S3 form with the file input last", async () => {
		const { harness, agent, userId } = await signedIn();
		const response = await agent.post("/upload").type("form").send({});
		expect(response.status).toBe(200);
		const doc = documentOf(response.text);
		const form = doc.querySelector<HTMLFormElement>("[data-test-upload-s3-form]");
		assert(form, "the S3 form must render");
		expect(form.getAttribute("action")).toBe(`${TEST_APP_ORIGIN}/e2e/s3-media`);
		const named = [...form.querySelectorAll("[name]")];
		const last = named[named.length - 1];
		expect(last?.getAttribute("name")).toBe("file");
		expect(last?.getAttribute("accept")).toBe(".epub,.mp3,.m4a,.mp4");
		const uploadId = stagedUploadId(doc);
		const session = await harness.mediaUpload.findMediaUploadSession({
			uploadId,
			userId,
		});
		expect(session?.fileName).toBeUndefined();
		expect(session?.byteLength).toBeUndefined();
	});

	it("keeps a declared file name and size on the session", async () => {
		const { harness, agent, userId } = await signedIn();
		const response = await agent
			.post("/upload")
			.type("form")
			.send({ fileName: "dune.epub", byteLength: "1024" });
		const session = await harness.mediaUpload.findMediaUploadSession({
			uploadId: stagedUploadId(documentOf(response.text)),
			userId,
		});
		expect(session?.fileName).toBe("dune.epub");
		expect(session?.byteLength).toBe(1024);
	});

	it("commits a received EPUB once and sends the reader to the queue", async () => {
		const { harness, agent, userId } = await signedIn();
		const staged = await agent.post("/upload").type("form").send({});
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

	it("answers upload_unsupported_type, naming every format the member may upload, for a file no kind recognises", async () => {
		const { harness, agent } = await signedIn();
		const staged = await agent.post("/upload").type("form").send({});
		const uploadId = stagedUploadId(documentOf(staged.text));
		harness.mediaUpload.receivePendingOriginal({ uploadId, bytes: Buffer.from("not a zip at all") });
		const received = await agent.post(`/upload/${uploadId}/received`);
		expect(received.status).toBe(422);
		expect(errorCodeOf(received.text)).toBe("upload_unsupported_type");
		expect(
			documentOf(received.text).querySelector("[data-test-upload-error]")
				?.textContent,
		).toContain(
			"That file type isn't supported. Upload a DRM-free EPUB, an MP3 or M4A file, or an MP4 file.",
		);
		expect(harness.mediaUpload.publishedMediaUploadCommitted).toEqual([]);
	});

	it("commits a member's received MP3 as audio under the Audio label", async () => {
		const { harness, agent, userId, fixture } = await signedIn();
		const staged = await agent.post("/upload").type("form").send({});
		const uploadId = stagedUploadId(documentOf(staged.text));
		harness.mediaUpload.receivePendingOriginal({
			uploadId,
			bytes: mp3Prefix(),
		});

		const received = await agent.post(`/upload/${uploadId}/received`);

		expect(received.status).toBe(303);
		expect(harness.mediaUpload.publishedMediaUploadCommitted).toEqual([
			expect.objectContaining({ uploadId, userId, kind: "audio" }),
		]);
		const saved = await fixture.articleStore.findArticleByUrl(
			mintPrivateItemUrl(uploadId),
			{ kind: "reader", userId },
		);
		expect(saved?.metadata.siteName).toBe("Audio");
		expect(saved?.metadata.title).toBe("Audio upload");
	});

	it("commits a member's MP4 as video without the transcripts feature", async () => {
		const { harness, agent, userId } = await signedIn();
		const staged = await agent.post("/upload").type("form").send({ fileName: "talk.mp4", byteLength: 64 });
		const uploadId = stagedUploadId(documentOf(staged.text));
		harness.mediaUpload.receivePendingOriginal({ uploadId, bytes: mp4Prefix() });

		const received = await agent.post(`/upload/${uploadId}/received`);

		expect(received.status).toBe(303);
		expect(harness.mediaUpload.publishedMediaUploadCommitted).toEqual([
			expect.objectContaining({ uploadId, userId, kind: "video" }),
		]);
	});

	it("answers upload_too_large when the received file is over its detected kind's ceiling", async () => {
		const { harness, agent } = await signedIn();
		const staged = await agent.post("/upload").type("form").send({});
		const uploadId = stagedUploadId(documentOf(staged.text));
		const prefix = Buffer.alloc(1024);
		Buffer.from(epubPrefix()).copy(prefix, 0);
		harness.mediaUpload.receivePendingOriginal({
			uploadId,
			bytes: prefix,
			byteLength: 200 * 1024 * 1024 + 1,
		});
		const received = await agent.post(`/upload/${uploadId}/received`);
		expect(received.status).toBe(413);
		expect(errorCodeOf(received.text)).toBe("upload_too_large");
		expect(harness.mediaUpload.publishedMediaUploadCommitted).toEqual([]);
	});

	it.each([
		{ startPath: "/upload?features=transcripts", features: "transcripts", allowance: 1 },
		{ startPath: "/upload", features: null, allowance: 1 },
	])("keeps the start path $startPath on a received file's error page", async ({ startPath, features, allowance }) => {
		const { harness, agent } = await signedIn();
		const staged = await agent.post(startPath).type("form").send({});
		const uploadId = stagedUploadId(documentOf(staged.text));
		harness.mediaUpload.receivePendingOriginal({ uploadId, bytes: Buffer.from("not a zip at all") });

		const received = await agent.post(`/upload/${uploadId}/received`);

		const doc = documentOf(received.text);
		expect(errorCodeOf(received.text)).toBe("upload_unsupported_type");
		const retry = new URL(doc.querySelector("[data-test-upload-start]")?.getAttribute("action") ?? "", TEST_APP_ORIGIN);
		expect({ pathname: retry.pathname, features: retry.searchParams.get("features") }).toEqual({
			pathname: "/upload",
			features,
		});
		expect(doc.querySelectorAll("[data-test-upload-transcript-allowance]").length).toBe(allowance);
	});

	it.each([
		{ startPath: "/upload?features=transcripts", features: "transcripts", allowance: 1 },
		{ startPath: "/upload", features: null, allowance: 1 },
	])("keeps the start path $startPath when a declared size is refused", async ({ startPath, features, allowance }) => {
		const { agent } = await signedIn();

		const response = await agent.post(startPath).type("form").send({ byteLength: 10 * 1024 * 1024 * 1024 });

		const doc = documentOf(response.text);
		expect(errorCodeOf(response.text)).toBe("upload_too_large");
		const retry = new URL(doc.querySelector("[data-test-upload-start]")?.getAttribute("action") ?? "", TEST_APP_ORIGIN);
		expect({ pathname: retry.pathname, features: retry.searchParams.get("features") }).toEqual({
			pathname: "/upload",
			features,
		});
		expect(doc.querySelectorAll("[data-test-upload-transcript-allowance]").length).toBe(allowance);
	});

	it("answers upload_session_not_found for an id the viewer does not own", async () => {
		const { agent } = await signedIn();
		const response = await agent.get("/upload/0123456789abcdef0123456789abcdef");
		expect(response.status).toBe(404);
		expect(documentOf(response.text).querySelector("[data-test-upload-error]")?.getAttribute("data-test-upload-error")).toBe("upload_session_not_found");
	});
	it("tells the owner a failed upload could not be opened", async () => {
		const { harness, agent, fixture } = await signedIn();
		const staged = await agent.post("/upload").type("form").send({});
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

		const stage = await agent.post("/upload").type("form").send({});
		expect(stage.status).toBe(403);
		expect(documentOf(stage.text).querySelector("h1")?.textContent).toBe("Your account is locked");

		const commit = await agent.post("/upload/0123456789abcdef0123456789abcdef/received");
		expect(commit.status).toBe(403);
		expect(documentOf(commit.text).querySelector("h1")?.textContent).toBe("Your account is locked");
		expect(harness.mediaUpload.publishedMediaUploadCommitted).toEqual([]);
	});

	it("stages a Siren upload as an entity whose S3 post answers 201 and puts the file last", async () => {
		const { harness, agent, userId } = await signedIn();
		const response = await agent
			.post("/upload")
			.set("Accept", SIREN)
			.type("form")
			.send({ fileName: "dune.epub", byteLength: "1024" });

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toContain(SIREN);
		expect(response.body.class).toEqual(["upload-staged"]);
		const uploadContent = actionNamed(response.body, "upload-content");
		expect(uploadContent).toMatchObject({ href: `${TEST_APP_ORIGIN}/e2e/s3-media`, method: "POST", type: "multipart/form-data" });
		const fields = uploadContent.fields ?? [];
		expect(fields.map((f) => f.name)).toEqual(["key", "success_action_status", "file"]);
		expect(fields.find((f) => f.name === "success_action_status")?.value).toBe("201");
		expect(fields[fields.length - 1]).toEqual({ name: "file", type: "file" });

		const key = fields.find((f) => f.name === "key")?.value;
		assert(key, "the post must carry the object key");
		const uploadId = UploadIdSchema.parse(key.replace("pending/", "").replace("/original", ""));
		expect(actionNamed(response.body, "confirm-received")).toEqual({
			name: "confirm-received",
			href: `/upload/${uploadId}/received`,
			method: "POST",
		});
		expect((await harness.mediaUpload.findMediaUploadSession({ uploadId, userId }))?.fileName).toBe("dune.epub");
	});

	it("keeps the HTML S3 form on a redirect back to the upload", async () => {
		const { agent } = await signedIn();
		const response = await agent.post("/upload").type("form").send({});
		const doc = documentOf(response.text);
		const uploadId = stagedUploadId(doc);
		expect(doc.querySelector('[data-test-upload-s3-form] input[name="success_action_redirect"]')?.getAttribute("value")).toBe(
			`${TEST_APP_ORIGIN}/upload/${uploadId}`,
		);
		expect(doc.querySelector('[data-test-upload-s3-form] input[name="success_action_status"]')).toBeNull();
	});

	it.each([
		{ code: "upload_too_large", status: 413, body: { byteLength: String(2 * 1024 * 1024 * 1024 + 1) } },
	])("answers a Siren $status error with $code", async ({ code, status, body }) => {
		const { agent } = await signedIn();
		const response = await agent.post("/upload").set("Accept", SIREN).type("form").send(body);
		expect(response.status).toBe(status);
		expect(response.body.class).toEqual(["error"]);
		expect(response.body.properties.code).toBe(code);
		expect(typeof response.body.properties.message).toBe("string");
	});

	it("confirms a Siren upload: not received, then committed with a redirect to the queue", async () => {
		const { harness, agent } = await signedIn();
		const staged = await agent.post("/upload").set("Accept", SIREN).type("form").send({});
		const confirm = actionNamed(staged.body, "confirm-received").href;
		const uploadId = UploadIdSchema.parse(confirm.split("/")[2]);

		const notYet = await agent.post(confirm).set("Accept", SIREN);
		expect(notYet.status).toBe(409);
		expect(notYet.body.properties).toEqual({
			code: "upload_not_received",
			message: "We didn't receive your file. Choose it and upload it again.",
			messages: errorMessages("We didn't receive your file. Choose it and upload it again."),
		});

		const landing = await agent.get(`/upload/${uploadId}`).set("Accept", SIREN);
		expect(landing.status).toBe(200);
		expect(actionNamed(landing.body, "confirm-received").href).toBe(confirm);

		harness.mediaUpload.receivePendingOriginal({ uploadId, bytes: epubPrefix() });
		const received = await agent.post(confirm).set("Accept", SIREN);
		expect(received.status).toBe(303);
		expect(received.headers.location).toBe("/queue");
	});

	it("answers Siren errors for an unrecognised file, an unknown session and a failed upload", async () => {
		const { harness, agent, fixture } = await signedIn();
		const staged = await agent.post("/upload").set("Accept", SIREN).type("form").send({});
		const confirm = actionNamed(staged.body, "confirm-received").href;
		const uploadId = UploadIdSchema.parse(confirm.split("/")[2]);
		harness.mediaUpload.receivePendingOriginal({ uploadId, bytes: Buffer.from("not a zip at all") });

		const unrecognised = await agent.post(confirm).set("Accept", SIREN);
		expect(unrecognised.status).toBe(422);
		expect(unrecognised.body.properties).toEqual({
			code: "upload_unsupported_type",
			message: "That file type isn't supported. Upload a DRM-free EPUB, an MP3 or M4A file, or an MP4 file.",
			messages: errorMessages("That file type isn't supported. Upload a DRM-free EPUB, an MP3 or M4A file, or an MP4 file."),
		});

		const unknown = await agent.get("/upload/0123456789abcdef0123456789abcdef").set("Accept", SIREN);
		expect(unknown.status).toBe(404);
		expect(unknown.body.properties.code).toBe("upload_session_not_found");

		harness.mediaUpload.receivePendingOriginal({ uploadId, bytes: epubPrefix() });
		expect((await agent.post(confirm).set("Accept", SIREN)).status).toBe(303);
		await fixture.mediaUpload.failMediaUpload({ uploadId });
		const failed = await agent.get(`/upload/${uploadId}`).set("Accept", SIREN);
		expect(failed.status).toBe(422);
		expect(failed.body.properties).toEqual({
			code: "upload_failed",
			message: "We couldn't open that upload. Check your readlist for the reason, or upload the file again.",
			messages: errorMessages("We couldn't open that upload. Check your readlist for the reason, or upload the file again."),
		});
	});

	it("stages a Siren upload from a guest with no bearer and no cookie", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.post("/upload")
			.set("Accept", SIREN)
			.type("form")
			.send({ fileName: "dune.epub", byteLength: "1024" });

		expect(response.status).toBe(200);
		expect(response.body.class).toEqual(["upload-staged"]);
		const uploadId = UploadIdSchema.parse(actionNamed(response.body, "confirm-received").href.split("/")[2]);
		const session = await harness.mediaUpload.findMediaUploadByCapability({ uploadId, userId: undefined });
		assert(session, "the guest's upload session must be stored");
		expect(isSignedInMediaUploadSession(session)).toBe(false);
	});

	it("opens the owner's committed book in the reader", async () => {
		const { harness, agent, fixture } = await signedIn();
		const staged = await agent.post("/upload").type("form").send({});
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

function errorMessages(body: string) {
	return [{ type: "error", content: { type: "text/html", body } }];
}

async function bearerFor(fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN)) {
	const { harness, userId } = await signedIn(fixture);
	const token = await saveAccessTokenForUser(harness, userId);
	const sirenPost = (path: string) =>
		request(harness.server).post(path).set("Accept", SIREN).set("Authorization", `Bearer ${token}`);
	const sirenGet = (path: string) =>
		request(harness.server).get(path).set("Accept", SIREN).set("Authorization", `Bearer ${token}`);
	return { harness, userId, token, fixture, sirenPost, sirenGet };
}

async function bearerStage(post: (path: string) => request.Test, body: Record<string, string> = {}) {
	const staged = await post("/upload").type("form").send(body);
	const confirm = actionNamed(staged.body, "confirm-received").href;
	return { staged, confirm, uploadId: UploadIdSchema.parse(confirm.split("/")[2]) };
}

describe("Upload routes for a bearer client", () => {
	it("stages an upload owned by the token's user", async () => {
		const { harness, userId, sirenPost } = await bearerFor();
		const { staged, uploadId } = await bearerStage(sirenPost, { fileName: "dune.epub", byteLength: "1024" });

		expect(staged.status).toBe(200);
		expect(staged.body.class).toEqual(["upload-staged"]);
		expect(staged.body.actions.map((a: SirenActionBody) => a.name)).toEqual(["upload-content", "confirm-received"]);
		expect((await harness.mediaUpload.findMediaUploadSession({ uploadId, userId }))?.userId).toBe(userId);
	});

	it("refuses an invalid bearer before staging anything", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.post("/upload")
			.set("Accept", SIREN)
			.set("Authorization", "Bearer not-a-real-token")
			.type("form")
			.send({ fileName: "dune.epub", byteLength: "1024" });

		expect(response.status).toBe(401);
		expect(response.body.properties.code).toBe("invalid-token");
	});

	it("commits a received upload once and redirects to the queue on every confirm", async () => {
		const { harness, sirenPost } = await bearerFor();
		const { confirm, uploadId } = await bearerStage(sirenPost);
		harness.mediaUpload.receivePendingOriginal({ uploadId, bytes: epubPrefix() });

		const first = await sirenPost(confirm).redirects(0);
		expect([first.status, first.headers.location]).toEqual([303, "/queue"]);
		expect(harness.mediaUpload.publishedMediaUploadCommitted).toHaveLength(1);

		const repeat = await sirenPost(confirm).redirects(0);
		expect([repeat.status, repeat.headers.location]).toEqual([303, "/queue"]);
		expect(harness.mediaUpload.publishedMediaUploadCommitted).toHaveLength(1);
	});

	it("answers not found, with messages, for another reader's upload", async () => {
		const { harness, sirenPost } = await bearerFor();
		const { confirm, uploadId } = await bearerStage(sirenPost);
		harness.mediaUpload.receivePendingOriginal({ uploadId, bytes: epubPrefix() });
		const other = await harness.auth.createUser({ email: "other@example.com", password: "password123" });
		assert(other.ok, "the second reader must be created");
		const otherToken = await saveAccessTokenForUser(harness, other.userId);

		const response = await request(harness.server)
			.post(confirm)
			.set("Accept", SIREN)
			.set("Authorization", `Bearer ${otherToken}`);

		expect(response.status).toBe(404);
		expect(response.body.properties.code).toBe("upload_session_not_found");
		expect(response.body.properties.messages).toEqual(
			errorMessages(uploadErrorMessageOf({ code: "upload_session_not_found", kinds: [] })),
		);
	});

	it("answers a too-large stage with messages", async () => {
		const { sirenPost } = await bearerFor();
		const response = await sirenPost("/upload")
			.type("form")
			.send({ fileName: "huge.mp4", byteLength: String(2 * 1024 * 1024 * 1024 + 1) });

		expect(response.status).toBe(413);
		expect(response.body.properties).toEqual({
			code: "upload_too_large",
			message: "That file is over the upload limit.",
			messages: errorMessages("That file is over the upload limit."),
		});
	});

	it("answers confirm errors with messages: not received, unsupported type, then failed", async () => {
		const { harness, fixture, sirenPost, sirenGet } = await bearerFor();
		const { confirm, uploadId } = await bearerStage(sirenPost);

		const notYet = await sirenPost(confirm);
		expect(notYet.status).toBe(409);
		expect(notYet.body.properties.messages).toEqual(
			errorMessages("We didn't receive your file. Choose it and upload it again."),
		);

		harness.mediaUpload.receivePendingOriginal({ uploadId, bytes: Buffer.from("not a zip at all") });
		const unsupported = await sirenPost(confirm);
		expect(unsupported.status).toBe(422);
		expect(unsupported.body.properties.messages).toEqual(
			errorMessages("That file type isn't supported. Upload a DRM-free EPUB, an MP3 or M4A file, or an MP4 file."),
		);

		harness.mediaUpload.receivePendingOriginal({ uploadId, bytes: epubPrefix() });
		expect((await sirenPost(confirm).redirects(0)).status).toBe(303);
		await fixture.mediaUpload.failMediaUpload({ uploadId });
		const failed = await sirenGet(`/upload/${uploadId}`);
		expect(failed.status).toBe(422);
		expect(failed.body.properties.messages).toEqual(errorMessages(UPLOAD_FAILED_MESSAGE));
	});

	it("refuses a locked account's stage", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.shared.now = () => new Date(Date.now() + 8 * ONE_DAY_MS);
		const { sirenPost } = await bearerFor(fixture);

		const response = await sirenPost("/upload").type("form").send({ fileName: "dune.epub", byteLength: "1024" });

		expect(response.status).toBe(403);
		expect(response.body).toEqual(accountLockedSirenError());
	});
});
