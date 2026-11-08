import assert from "node:assert/strict";
import { ReaderArticleHashId } from "@packages/domain/article";
import { EnclosureSchema } from "@packages/media-contracts";
import { JSDOM } from "jsdom";
import { createDefaultTestAppFixture, TEST_APP_ORIGIN } from "@packages/test-fixtures";
import request from "supertest";
import { BROWSER_REQUEST_HEADERS, useTestServer } from "../../../test-app";

const AUDIO_URL = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
const AUDIO_ID = ReaderArticleHashId.from(AUDIO_URL).value;
const SILENT_URL = "https://uploads.readplace.invalid/fedcba9876543210fedcba9876543210";
const SILENT_ID = ReaderArticleHashId.from(SILENT_URL).value;
const ENCLOSURE = EnclosureSchema.parse({
	object: `objects/sha256/${"0123456789abcdef".repeat(4)}/1`,
	mediaType: "audio/mpeg",
	durationSeconds: 2820,
});
const OWNER = { email: "owner@example.com", password: "password123" };
const NOT_THE_OWNER = { email: "someone-else@example.com", password: "password123" };

const useApp = useTestServer();

async function appWithOwnersAudio() {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const harness = useApp(fixture);
	const owner = await harness.auth.createUser(OWNER);
	assert(owner.ok, "owner should be created");
	const savedAt = new Date("2026-11-05T00:00:00.000Z");
	await fixture.articleStore.savePrivateItem({
		url: AUDIO_URL,
		ownerUserId: owner.userId,
		media: { kind: "audio", fileName: "talk.mp3" },
		savedAt,
	});
	assert.equal(await fixture.articleStore.setArticleEnclosure({ url: AUDIO_URL, enclosure: ENCLOSURE }), "recorded");
	await fixture.articleStore.savePrivateItem({
		url: SILENT_URL,
		ownerUserId: owner.userId,
		media: { kind: "audio", fileName: "pending.mp3" },
		savedAt,
	});
	const signIn = async (credentials: typeof OWNER) => {
		const agent = request.agent(harness.server);
		await agent.post("/login").set(BROWSER_REQUEST_HEADERS).type("form").send(credentials);
		return agent;
	};
	return { fixture, harness, signIn };
}

describe("GET /queue/:id/enclosure", () => {
	it("redirects the owner to the presigned enclosure URL that no shared cache may keep", async () => {
		const { fixture, signIn } = await appWithOwnersAudio();
		const agent = await signIn(OWNER);

		const response = await agent.get(`/queue/${AUDIO_ID}/enclosure`).set(BROWSER_REQUEST_HEADERS);

		assert.equal(response.status, 302);
		assert.equal(response.headers.location, `https://media.test/${ENCLOSURE.object}`);
		assert.equal(response.headers["cache-control"], "private, no-store");
		assert.deepEqual(fixture.mediaUpload.presignedEnclosures, [{ object: ENCLOSURE.object, mediaType: "audio/mpeg" }]);
	});

	it("answers another reader with a 404", async () => {
		const { fixture, harness, signIn } = await appWithOwnersAudio();
		const other = await harness.auth.createUser(NOT_THE_OWNER);
		assert(other.ok, "the other reader should be created");
		const agent = await signIn(NOT_THE_OWNER);

		const response = await agent.get(`/queue/${AUDIO_ID}/enclosure`).set(BROWSER_REQUEST_HEADERS);

		assert.equal(response.status, 404);
		assert.deepEqual(fixture.mediaUpload.presignedEnclosures, []);
	});

	it("answers a logged-out request with a 404 and no redirect", async () => {
		const { fixture, harness } = await appWithOwnersAudio();

		const response = await request(harness.server).get(`/queue/${AUDIO_ID}/enclosure`).set(BROWSER_REQUEST_HEADERS);

		assert.equal(response.status, 404);
		assert.equal(response.headers.location, undefined);
		assert.deepEqual(fixture.mediaUpload.presignedEnclosures, []);
	});

	it.each([
		["a row without an enclosure", `/queue/${SILENT_ID}/enclosure`],
		["an id no article has", "/queue/ffffffffffffffffffffffffffffffff/enclosure"],
		["an id that is not a route id", "/queue/not-a-route-id/enclosure"],
	])("answers the owner's request for %s with a 404", async (_label, path) => {
		const { fixture, signIn } = await appWithOwnersAudio();
		const agent = await signIn(OWNER);

		const response = await agent.get(path).set(BROWSER_REQUEST_HEADERS);

		assert.equal(response.status, 404);
		assert.deepEqual(fixture.mediaUpload.presignedEnclosures, []);
	});
});

describe("an owned audio item whose transcript did not come", () => {
	it.each([
		["no-speech", "No speech was found in this file, so there's no transcript.", `/queue/${AUDIO_ID}/view`],
		["transcript-failed", "Readplace couldn't transcribe this file. You can upload it again.", `/queue/${AUDIO_ID}/view?platform=ios`],
		["no-speech", "No speech was found in this file, so there's no transcript.", `/queue/${AUDIO_ID}/reader?poll=1`],
		["transcript-failed", "Readplace couldn't transcribe this file. You can upload it again.", `/queue/${AUDIO_ID}/reader?poll=1`],
	] as const)("shows the %s notice in the reader slot", async (transcript, explanation, path) => {
		const { fixture, signIn } = await appWithOwnersAudio();
		assert.equal(await fixture.articleStore.recordTranscriptOutcome({ url: AUDIO_URL, transcript }), "recorded");
		const agent = await signIn(OWNER);

		const response = await agent.get(path).set(BROWSER_REQUEST_HEADERS);

		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-reader-slot]")?.getAttribute("data-reader-status")).toBe(transcript);
		expect(doc.querySelector(".article-body__reader-notice-title")?.textContent?.trim()).toBe("Your audio is saved");
		expect(doc.querySelector(".article-body__reader-notice-text")?.textContent?.trim()).toBe(explanation);
		expect(doc.querySelector("[data-test-reader-slot]")?.hasAttribute("hx-get")).toBe(false);
	});

	it("keeps the notice when the summary poll answers", async () => {
		const { fixture, signIn } = await appWithOwnersAudio();
		await fixture.articleStore.recordTranscriptOutcome({ url: AUDIO_URL, transcript: "no-speech" });
		const agent = await signIn(OWNER);

		const response = await agent.get(`/queue/${AUDIO_ID}/summary?poll=1`).set(BROWSER_REQUEST_HEADERS);

		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector(".article-body__reader-notice-title")?.textContent?.trim()).toBe("Your audio is saved");
	});

	it("keeps the audio player on the page beside the notice", async () => {
		const { fixture, signIn } = await appWithOwnersAudio();
		await fixture.articleStore.recordTranscriptOutcome({ url: AUDIO_URL, transcript: "no-speech" });
		const agent = await signIn(OWNER);

		const response = await agent.get(`/queue/${AUDIO_ID}/view`).set(BROWSER_REQUEST_HEADERS);

		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector('[data-test-reader-player="audio"] audio[data-player-audio]')?.getAttribute("src")).toBe(
			`/queue/${AUDIO_ID}/enclosure`,
		);
	});
});
