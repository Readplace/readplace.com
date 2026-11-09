import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import type { ReadTimedDuration } from "@packages/domain";
import { AUDIO, MEDIA_KINDS, UploadIdSchema, defineMediaKind } from "@packages/media-contracts";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { findUntrackedCtas } from "@packages/web-test-harness";
import { loginAgent, useTestServer } from "../../../test-app";
import { defaultFileNameOf } from "./commit-received-upload";

let duration: Awaited<ReturnType<ReadTimedDuration>> = { durationSeconds: 600, hasAudio: true, hasVideo: false };
const readDuration: ReadTimedDuration = async () => duration;
const useApp = useTestServer({ readDurationByMeter: new Map([["transcript-seconds" as const, readDuration]]) });

beforeEach(() => {
	duration = { durationSeconds: 600, hasAudio: true, hasVideo: false };
});

function mp3Prefix(): Uint8Array {
	return Buffer.from("ID3\x04\x00\x00\x00\x00\x00\x00", "latin1");
}

function documentOf(html: string): Document {
	return new JSDOM(html).window.document;
}

type Harness = ReturnType<typeof useApp>;

async function stageAudio(params: { harness: Harness; agent: ReturnType<typeof request.agent>; startPath: string }) {
	const staged = await params.agent.post(params.startPath).type("form").send({});
	const key = documentOf(staged.text).querySelector<HTMLInputElement>('[data-test-upload-s3-form] input[name="key"]')?.value;
	assert(key, "the S3 form must carry the object key");
	const uploadId = UploadIdSchema.parse(key.replace("pending/", "").replace("/original", ""));
	params.harness.mediaUpload.receivePendingOriginal({ uploadId, bytes: mp3Prefix() });
	const received = await params.agent.post(`/upload/${uploadId}/received`);
	return { uploadId, received };
}

async function guestAudio(harness: Harness) {
	return stageAudio({ harness, agent: request.agent(harness.server), startPath: "/upload?features=transcripts" });
}

function featuresOfUploadAgain(doc: Document): string | null {
	const href = doc.querySelector("[data-test-upload-again]")?.getAttribute("href");
	assert(href, "Upload again must carry a target");
	return new URL(href, TEST_APP_ORIGIN).searchParams.get("features");
}

async function reviewOf(harness: Harness, uploadId: string) {
	const view = await request(harness.server).get(`/upload/${uploadId}`);
	return { view, doc: documentOf(view.text) };
}

describe("Guest audio review", () => {
	it("shows a flagged guest the file, its length and the minutes it uses today", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { uploadId, received } = await guestAudio(harness);

		expect(received.status).toBe(303);
		expect(harness.mediaUpload.publishedMediaUploadStaged).toEqual([]);
		const { view, doc } = await reviewOf(harness, uploadId);
		expect(doc.querySelector("#upload-status")?.getAttribute("data-upload-status")).toBe("timed-review");
		expect(doc.querySelector("h1")?.textContent).toBe("Upload an audio file");
		expect(doc.title).toBe("Upload an audio file — Readplace");
		expect(doc.querySelector("[data-test-upload-timed-review] [data-test-upload-heading]")?.textContent).toBe(
			defaultFileNameOf(AUDIO),
		);
		expect(doc.querySelector("[data-test-upload-duration]")?.textContent).toBe("10 min");
		expect(doc.querySelector("[data-test-transcript-minutes]")?.textContent).toBe("Uses 10 of your 20 transcript minutes today");
		expect(doc.querySelector("[data-test-upload-commit-form]")).not.toBeNull();
		expect(findUntrackedCtas(view.text, { skipSelectors: [], ownOrigin: TEST_APP_ORIGIN })).toEqual([]);
	});

	it("charges a flagged guest's file shorter than a minute as a whole transcript minute", async () => {
		duration = { durationSeconds: 50, hasAudio: true, hasVideo: false };
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { uploadId } = await guestAudio(harness);

		const { doc } = await reviewOf(harness, uploadId);
		expect(doc.querySelector("[data-test-upload-duration]")?.textContent).toBe("1 min");
		expect(doc.querySelector("[data-test-transcript-minutes]")?.textContent).toBe(
			"Uses 1 of your 20 transcript minutes today",
		);
	});

	it("shows a file metadata reads a frame over two minutes as 2 minutes on both lines", async () => {
		duration = { durationSeconds: 120.046, hasAudio: true, hasVideo: false };
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { uploadId } = await guestAudio(harness);

		const { doc } = await reviewOf(harness, uploadId);
		expect(doc.querySelector("[data-test-upload-duration]")?.textContent).toBe("2 min");
		expect(doc.querySelector("[data-test-transcript-minutes]")?.textContent).toBe(
			"Uses 2 of your 20 transcript minutes today",
		);
	});

	it("refuses a flagged guest's audio longer than the day's allowance, with no way to save it", async () => {
		duration = { durationSeconds: 1251, hasAudio: true, hasVideo: false };
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { uploadId } = await guestAudio(harness);

		const { view, doc } = await reviewOf(harness, uploadId);
		expect(doc.querySelector("#upload-status")?.getAttribute("data-upload-status")).toBe("too-long");
		expect(doc.querySelector("[data-test-upload-notice]")?.textContent).toBe(
			"This file is longer than your 20 minutes of transcript a day. Split it into parts of 20 minutes or less.",
		);
		expect(doc.querySelector("[data-test-upload-commit-form]")).toBeNull();
		expect(findUntrackedCtas(view.text, { skipSelectors: [], ownOrigin: TEST_APP_ORIGIN })).toEqual([]);
		expect(featuresOfUploadAgain(doc)).toBe("transcripts");
	});

	it.each([
		{ name: "an unreadable file", read: { unreadable: true as const } },
		{ name: "a file with no audio", read: { durationSeconds: 600, hasAudio: false, hasVideo: false } },
	])("rejects $name a flagged guest uploads", async ({ read }) => {
		duration = read;
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { uploadId } = await guestAudio(harness);

		const { doc } = await reviewOf(harness, uploadId);
		expect(doc.querySelector("#upload-status")?.getAttribute("data-upload-status")).toBe("rejected");
		expect(doc.querySelector("[data-test-upload-notice]")?.textContent).toBe(
			"Readplace couldn't read this audio file. Upload an MP3 or M4A that plays on your device.",
		);
		expect(featuresOfUploadAgain(doc)).toBe("transcripts");
	});

	it.each([
		{
			name: "past the allowance as too long",
			atLeastSeconds: 1251,
			notice: "This file is longer than your 20 minutes of transcript a day. Split it into parts of 20 minutes or less.",
		},
		{
			name: "inside the allowance as unreadable",
			atLeastSeconds: 600,
			notice: "Readplace couldn't read this audio file. Upload an MP3 or M4A that plays on your device.",
		},
	])("rejects a flagged guest's audio whose scan was cut off $name", async ({ atLeastSeconds, notice }) => {
		duration = { atLeastSeconds };
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { uploadId } = await guestAudio(harness);

		const { doc } = await reviewOf(harness, uploadId);
		expect(doc.querySelector("#upload-status")?.getAttribute("data-upload-status")).toBe("rejected");
		expect(doc.querySelector("[data-test-upload-notice]")?.textContent).toBe(notice);
		expect(doc.querySelector("[data-test-upload-commit-form]")).toBeNull();
	});

	it("charges the reader who saves a flagged guest's audio", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { uploadId } = await guestAudio(harness);
		const agent = await loginAgent(harness.server, harness.auth);

		const commit = await agent.post(`/upload/${uploadId}/commit`);

		expect(commit.status).toBe(303);
		expect(commit.headers.location).toBe("/queue");
		expect(harness.mediaUpload.publishedMediaUploadCommitted).toEqual([
			expect.objectContaining({ uploadId, kind: "audio", chargedSeconds: 600 }),
		]);
	});

	it("refuses to save a flagged guest's audio once the reader's day is spent", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await stageAudio({ harness, agent, startPath: "/upload?features=transcripts" });
		await stageAudio({ harness, agent, startPath: "/upload?features=transcripts" });
		const { uploadId } = await guestAudio(harness);

		const commit = await agent.post(`/upload/${uploadId}/commit`);

		expect(commit.status).toBe(303);
		expect(commit.headers.location).toBe("/upload?features=transcripts&refused=transcript-quota");
		expect(harness.mediaUpload.publishedMediaUploadCommitted).toHaveLength(2);
	});
});

describe("Guest timed review refused by the kind's own judgement", () => {
	const SILENT = defineMediaKind({ ...AUDIO, refuseTimedFacts: () => "no-audio-track" as const });
	const useSilentApp = useTestServer({
		mediaKinds: new Map([...MEDIA_KINDS, ["audio", SILENT]]),
		readDurationByMeter: new Map([["transcript-seconds" as const, readDuration]]),
	});

	it("rejects the guest's upload before signup with the kind's refusal", async () => {
		const harness = useSilentApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { uploadId, received } = await stageAudio({
			harness,
			agent: request.agent(harness.server),
			startPath: "/upload?features=transcripts",
		});

		expect(received.status).toBe(303);
		expect(received.headers.location).toBe(`/upload/${uploadId}`);
		const { doc } = await reviewOf(harness, uploadId);
		expect(doc.querySelector("#upload-status")?.getAttribute("data-upload-status")).toBe("rejected");
		expect(doc.querySelector("[data-test-upload-notice]")?.textContent).toBe(
			"This video has no sound, so there's nothing to transcribe.",
		);
		expect(doc.querySelector("[data-test-upload-commit-form]")).toBeNull();
	});
});
