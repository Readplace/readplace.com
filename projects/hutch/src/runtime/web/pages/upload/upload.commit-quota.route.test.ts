import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { ReadTimedDuration } from "@packages/domain";
import { ChargedMediaUploadCommittedDetailSchema } from "@packages/infra-components";
import { AUDIO, MEDIA_KINDS, UploadIdSchema, defineMediaKind, mintPrivateItemUrl } from "@packages/media-contracts";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer, loginAgent } from "../../../test-app";

const METERED_AUDIO = defineMediaKind({ ...AUDIO, meter: "transcript-seconds", listenTime: (seconds) => seconds });
const readTenMinutes: ReadTimedDuration = async () => ({ durationSeconds: 600, hasAudio: true, hasVideo: false });
const useApp = useTestServer({
	mediaKinds: new Map([...MEDIA_KINDS, ["audio", METERED_AUDIO]]),
	readDurationByMeter: new Map([["transcript-seconds" as const, readTenMinutes]]),
});

function mp3Prefix(): Uint8Array {
	return Buffer.from("ID3\x04\x00\x00\x00\x00\x00\x00", "latin1");
}

function epubPrefix(): Uint8Array {
	const bytes = Buffer.alloc(64);
	Buffer.from([0x50, 0x4b, 0x03, 0x04]).copy(bytes, 0);
	Buffer.from("mimetypeapplication/epub+zip").copy(bytes, 30);
	return bytes;
}

function documentOf(html: string): Document {
	return new JSDOM(html).window.document;
}

async function signedIn(fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN)) {
	const harness = useApp(fixture);
	const agent = await loginAgent(harness.server, harness.auth);
	const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
	assert(userId, "seeded login user must exist");
	return { harness, agent, userId };
}

async function uploadAndReceive(params: {
	signed: Pick<Awaited<ReturnType<typeof signedIn>>, "harness" | "agent">;
	startPath: string;
	bytes: Uint8Array;
}) {
	const staged = await params.signed.agent.post(params.startPath).type("form").send({});
	const key = documentOf(staged.text).querySelector<HTMLInputElement>('[data-test-upload-s3-form] input[name="key"]')?.value;
	assert(key, "the S3 form must carry the object key");
	const uploadId = UploadIdSchema.parse(key.replace("pending/", "").replace("/original", ""));
	params.signed.harness.mediaUpload.receivePendingOriginal({ uploadId, bytes: params.bytes });
	const received = await params.signed.agent.post(`/upload/${uploadId}/received`);
	return { uploadId, received };
}

describe("Metered upload commit", () => {
	it("commits a flagged member's MP4 as video", async () => {
		const signed = await signedIn();
		const staged = await signed.agent
			.post("/upload?features=transcripts")
			.type("form")
			.send({ fileName: "talk.mp4", byteLength: 64 });
		const key = documentOf(staged.text).querySelector<HTMLInputElement>('[data-test-upload-s3-form] input[name="key"]')?.value;
		assert(key, "the S3 form must carry the object key");
		const uploadId = UploadIdSchema.parse(key.replace("pending/", "").replace("/original", ""));
		signed.harness.mediaUpload.receivePendingOriginal({
			uploadId,
			bytes: Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom", "latin1"), Buffer.alloc(20)]),
		});

		const received = await signed.agent.post(`/upload/${uploadId}/received`);

		expect(received.status).toBe(303);
		expect(signed.harness.mediaUpload.publishedMediaUploadCommitted).toEqual([
			expect.objectContaining({ uploadId, userId: signed.userId, kind: "video" }),
		]);
	});

	it("charges a flagged audio upload and publishes the charge media-audio transcribes from", async () => {
		const signed = await signedIn();

		const { uploadId, received } = await uploadAndReceive({
			signed,
			startPath: "/upload?features=transcripts",
			bytes: mp3Prefix(),
		});

		expect(received.status).toBe(303);
		const [published] = signed.harness.mediaUpload.publishedMediaUploadCommitted;
		expect(ChargedMediaUploadCommittedDetailSchema.parse(published)).toEqual(
			expect.objectContaining({ uploadId, kind: "audio", chargedSeconds: 600, chargedDay: expect.any(String) }),
		);
	});

	it("refuses the flagged upload that would pass the day's allowance and keeps the flag on the retry", async () => {
		const signed = await signedIn();
		await uploadAndReceive({ signed, startPath: "/upload?features=transcripts", bytes: mp3Prefix() });
		await uploadAndReceive({ signed, startPath: "/upload?features=transcripts", bytes: mp3Prefix() });

		const third = await uploadAndReceive({ signed, startPath: "/upload?features=transcripts", bytes: mp3Prefix() });

		expect(third.received.status).toBe(303);
		expect(third.received.headers.location).toBe("/upload?features=transcripts&refused=transcript-quota");
		expect(signed.harness.mediaUpload.publishedMediaUploadCommitted).toHaveLength(2);
	});

	it("names the refusal on the start page and keeps the start form metered", async () => {
		const signed = await signedIn();

		const page = await signed.agent.get("/upload?features=transcripts&refused=transcript-too-long");

		const doc = documentOf(page.text);
		const alert = doc.querySelector('[data-test-alert="upload-refusal"]');
		expect(alert?.getAttribute("role")).toBe("alert");
		expect(alert?.getAttribute("data-test-alert-variant")).toBe("error");
		expect(alert?.querySelector("[data-test-alert-message]")?.textContent).toBe(
			"This file is longer than your 20 minutes of transcript a day. Split it into parts of 20 minutes or less.",
		);
		expect(doc.querySelector("[data-test-upload-start]")?.getAttribute("action")).toMatch(/^\/upload\?features=transcripts&utm_/);
	});

	it("names the book-quota refusal with the instant the reader may upload another book", async () => {
		const signed = await signedIn();

		const page = await signed.agent.get(
			"/upload?features=transcripts&refused=book-quota&retry_at=2026-11-14T00%3A00%3A00.000Z",
		);

		const message = documentOf(page.text).querySelector('[data-test-alert="upload-refusal"] [data-test-alert-message]');
		assert(message, "the book-quota refusal must render its message");
		expect(message.textContent?.trim()).toBe(
			"You've reached today's limit for book uploads. You can upload another book after Nov 14, 2026, 00:00 UTC.",
		);
		const time = message.querySelector("time");
		expect(time?.getAttribute("datetime")).toBe("2026-11-14T00:00:00.000Z");
		expect(time?.getAttribute("data-local-time")).toBe("datetime");
	});

	it("commits every EPUB from a full-access account past the metered book limit", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.rateLimit = {
			...fixture.rateLimit,
			rules: { ...fixture.rateLimit.rules, bookUpload: { limit: 1, windowSeconds: 86_400 } },
		};
		const signed = await signedIn(fixture);

		const first = await uploadAndReceive({ signed, startPath: "/upload?features=transcripts", bytes: epubPrefix() });
		const second = await uploadAndReceive({ signed, startPath: "/upload?features=transcripts", bytes: epubPrefix() });

		expect([first.received.status, second.received.status]).toEqual([303, 303]);
		expect([first.received.headers.location, second.received.headers.location]).toEqual(["/queue", "/queue"]);
		expect(signed.harness.mediaUpload.publishedMediaUploadCommitted).toHaveLength(2);
	});

	it("refuses a free-plan account's second metered book past the day's book limit", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.rateLimit = {
			...fixture.rateLimit,
			rules: { ...fixture.rateLimit.rules, bookUpload: { limit: 1, windowSeconds: 86_400 } },
		};
		const signed = await signedIn(fixture);
		signed.harness.subscriptionProviders.seedRow({
			userId: signed.userId,
			provider: "stripe",
			status: "cancelled",
			createdAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
			updatedAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
		});

		const first = await uploadAndReceive({ signed, startPath: "/upload?features=transcripts", bytes: epubPrefix() });
		const second = await uploadAndReceive({ signed, startPath: "/upload?features=transcripts", bytes: epubPrefix() });

		expect([first.received.status, first.received.headers.location]).toEqual([303, "/queue"]);
		expect(second.received.status).toBe(303);
		expect(second.received.headers.location).toMatch(/^\/upload\?features=transcripts&refused=book-quota&retry_at=/);
		expect(signed.harness.mediaUpload.publishedMediaUploadCommitted).toHaveLength(1);
	});

	it("hides the refusal alert for an unknown reason", async () => {
		const signed = await signedIn();

		const page = await signed.agent.get("/upload?refused=nonsense");

		const alert = documentOf(page.text).querySelector('[data-test-alert="upload-refusal"]');
		expect(alert?.classList.contains("alert--hidden")).toBe(true);
	});

	it("commits a flagged EPUB without a charge", async () => {
		const signed = await signedIn();

		const { uploadId } = await uploadAndReceive({
			signed,
			startPath: "/upload?features=transcripts",
			bytes: epubPrefix(),
		});

		expect(signed.harness.mediaUpload.publishedMediaUploadCommitted).toEqual([
			{
				uploadId,
				kind: "book",
				url: mintPrivateItemUrl(uploadId),
				userId: signed.userId,
				saveAttemptId: expect.any(String),
				etag: expect.any(String),
				attempt: 1,
			},
		]);
	});

	it("charges an unflagged audio upload for its transcript", async () => {
		const signed = await signedIn();

		const { uploadId } = await uploadAndReceive({ signed, startPath: "/upload", bytes: mp3Prefix() });

		const [published] = signed.harness.mediaUpload.publishedMediaUploadCommitted;
		expect(published).toEqual(expect.objectContaining({ uploadId, kind: "audio" }));
		expect(ChargedMediaUploadCommittedDetailSchema.safeParse(published).success).toBe(true);
	});
});

describe("Metered upload commit refused by the kind's own judgement", () => {
	const reads: Parameters<ReadTimedDuration>[0][] = [];
	const readSilently: ReadTimedDuration = async (params) => {
		reads.push(params);
		return { durationSeconds: 600, hasAudio: false, hasVideo: true };
	};
	const SILENT = defineMediaKind({ ...METERED_AUDIO, refuseTimedFacts: () => "no-audio-track" as const });
	const useSilentApp = useTestServer({
		mediaKinds: new Map([...MEDIA_KINDS, ["audio", SILENT]]),
		readDurationByMeter: new Map([["transcript-seconds" as const, readSilently]]),
	});

	beforeEach(() => {
		reads.splice(0);
	});

	it("redirects to the no-audio-track refusal without a charge or a commit", async () => {
		const harness = useSilentApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const { uploadId, received } = await uploadAndReceive({
			signed: { harness, agent },
			startPath: "/upload?features=transcripts",
			bytes: mp3Prefix(),
		});

		expect(received.status).toBe(303);
		expect(received.headers.location).toBe("/upload?features=transcripts&refused=no-audio-track");
		expect(reads).toEqual([{ uploadId, etag: expect.any(String) }]);
		expect(harness.mediaUpload.publishedMediaUploadCommitted).toEqual([]);
		const page = await agent.get("/upload?refused=no-audio-track");
		expect(
			documentOf(page.text).querySelector('[data-test-alert="upload-refusal"] [data-test-alert-message]')?.textContent,
		).toBe("This video has no sound, so there's nothing to transcribe.");
	});
});
