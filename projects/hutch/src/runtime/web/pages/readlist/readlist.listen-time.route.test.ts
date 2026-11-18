import assert from "node:assert/strict";
import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import { EnclosureSchema } from "@packages/media-contracts";
import {
	createDefaultTestAppFixture,
	TEST_APP_ORIGIN,
} from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import request from "supertest";
import { z } from "zod";
import { BROWSER_REQUEST_HEADERS, useTestServer } from "../../../test-app";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { saveAccessTokenForUser } from "../../test-helpers/oauth-token";

const AUDIO_URL =
	"https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
const AUDIO_ID = ReaderArticleHashId.from(AUDIO_URL).value;
const LINK_URL = "https://example.com/an-article";
const LINK_ID = ReaderArticleHashId.from(LINK_URL).value;
const ENCLOSURE = EnclosureSchema.parse({
	object: `objects/sha256/${"0123456789abcdef".repeat(4)}/1`,
	mediaType: "audio/mpeg",
	durationSeconds: 2820,
});
const OWNER = { email: "owner@example.com", password: "password123" };
const NOT_THE_OWNER = {
	email: "someone-else@example.com",
	password: "password123",
};

const SirenCollection = z.looseObject({
	entities: z.array(
		z.looseObject({
			properties: z.looseObject({
				url: z.string(),
				readTime: z.object({ label: z.string() }),
				mediaKind: z.string().nullable(),
				durationSeconds: z.number().nullable(),
			}),
		}),
	),
});

const TRANSCRIPT_HTML =
	'<h2>00:00</h2><p><a href="?t=0">00:00</a> Welcome to the talk.</p><h2>05:00</h2><p><a href="?t=300">05:00</a> The second part begins.</p>';

const useApp = useTestServer();

async function appWithOwnersEnclosure() {
	return appWithOwnersAudio("ready");
}

async function appWithOwnersAudio(
	audioCrawl: "ready" | "pending" | "transcript",
) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const harness = useApp(fixture);
	const owner = await harness.auth.createUser(OWNER);
	assert(owner.ok, "owner should be created");
	const savedAt = new Date("2026-11-05T00:00:00.000Z");
	for (const url of [AUDIO_URL, LINK_URL]) {
		await fixture.articleStore.saveArticle({
			userId: owner.userId,
			url,
			metadata: {
				title: "A talk",
				siteName: "example.com",
				excerpt: "",
				wordCount: 600,
			},
			estimatedReadTime: MinutesSchema.parse(3),
			provenance: { kind: "web" },
			savedAt,
			saveTrigger: "manual",
		});
		if (url === AUDIO_URL && audioCrawl === "pending") continue;
		await fixture.articleStore.writeContent({
			url,
			content:
				url === AUDIO_URL && audioCrawl === "transcript"
					? TRANSCRIPT_HTML
					: "<p>Body.</p>",
		});
		await fixture.articleCrawl.markCrawlReady({ url });
	}
	await fixture.articleStore.recordItemOwner({
		url: AUDIO_URL,
		ownerUserId: owner.userId,
	});
	assert.equal(
		await fixture.articleStore.setArticleEnclosure({
			url: AUDIO_URL,
			enclosure: ENCLOSURE,
		}),
		"recorded",
	);
	const signIn = async (credentials: typeof OWNER) => {
		const agent = request.agent(harness.server);
		await agent
			.post("/login")
			.set(BROWSER_REQUEST_HEADERS)
			.type("form")
			.send(credentials);
		return agent;
	};
	const ownerToken = () => saveAccessTokenForUser(harness, owner.userId);
	return { harness, signIn, ownerToken };
}

function documentOf(html: string): Document {
	return new JSDOM(html).window.document;
}

function cardReadTime(html: string, id: string): string | undefined {
	return documentOf(html)
		.querySelector(`[data-test-article="${id}"] [data-test-read-time]`)
		?.textContent?.trim();
}

function firstReaderChild(html: string): Element | undefined {
	const reader = documentOf(html).querySelector("main.reader");
	assert(reader, "the reader must be rendered");
	return Array.from(reader.children).find((child) => child.tagName !== "STYLE");
}

function playerScripts(html: string): string[] {
	return Array.from(documentOf(html).querySelectorAll("script[src]"))
		.map((script) => script.getAttribute("src") ?? "")
		.filter((src) => src.includes("player.client.js"));
}

function headerReadTime(html: string): string | undefined {
	return documentOf(html)
		.querySelector('#reader-article-meta [data-test-reader-fact="read-time"]')
		?.textContent?.trim();
}

describe("an owned enclosure in the reader", () => {
	it("puts the audio player first in the reader, playing the enclosure route", async () => {
		const { signIn } = await appWithOwnersEnclosure();
		const agent = await signIn(OWNER);

		const response = await agent
			.get(`/queue/${AUDIO_ID}/view`)
			.set(BROWSER_REQUEST_HEADERS);

		const player = firstReaderChild(response.text);
		expect(player?.getAttribute("data-test-reader-player")).toBe("audio");
		expect(
			player?.querySelector("audio[data-player-audio]")?.getAttribute("src"),
		).toBe(`/queue/${AUDIO_ID}/enclosure`);
		expect(headerReadTime(response.text)).toBe("47 min listen");
	});

	it("loads the player script once for the owner's audio and not for a link", async () => {
		const { signIn } = await appWithOwnersEnclosure();
		const agent = await signIn(OWNER);

		const audio = await agent.get(`/queue/${AUDIO_ID}/view`).set(BROWSER_REQUEST_HEADERS);
		const link = await agent.get(`/queue/${LINK_ID}/view`).set(BROWSER_REQUEST_HEADERS);

		expect(playerScripts(audio.text)).toEqual(["/client-dist/player.client.js"]);
		expect(playerScripts(link.text)).toEqual([]);
	});

	it("serves the rendered transcript with its five-minute headings and seek links", async () => {
		const { signIn } = await appWithOwnersAudio("transcript");
		const agent = await signIn(OWNER);

		const response = await agent
			.get(`/queue/${AUDIO_ID}/view`)
			.set(BROWSER_REQUEST_HEADERS);

		const body = documentOf(response.text).querySelector("[data-article-body]");
		expect(body?.querySelector("h2#section-05-00")?.textContent).toBe("05:00");
		expect(body?.querySelector('a[href="?t=300"]')?.textContent).toBe("05:00");
	});

	it("keeps the player outside the pending reader slot while the body is still being prepared", async () => {
		const { signIn } = await appWithOwnersAudio("pending");
		const agent = await signIn(OWNER);

		const response = await agent
			.get(`/queue/${AUDIO_ID}/view`)
			.set(BROWSER_REQUEST_HEADERS);

		const page = documentOf(response.text);
		const player = page.querySelector(
			'main.reader > [data-test-reader-player="audio"]',
		);
		const slot = page.querySelector(
			"[data-article-body] [data-test-reader-slot]",
		);
		expect(player).not.toBeNull();
		expect(slot?.getAttribute("data-reader-status")).toBe("pending");
		expect(slot?.contains(player)).toBe(false);
	});

	it("renders no player for a link", async () => {
		const { signIn } = await appWithOwnersEnclosure();
		const agent = await signIn(OWNER);

		const response = await agent
			.get(`/queue/${LINK_ID}/view`)
			.set(BROWSER_REQUEST_HEADERS);

		expect(
			firstReaderChild(response.text)?.getAttribute("data-test-reader-player"),
		).toBe("absent");
		expect(documentOf(response.text).querySelector("audio")).toBeNull();
		expect(headerReadTime(response.text)).toBe("3 min read");
	});

	it("renders no player for a reader who does not own the item", async () => {
		const { harness, signIn } = await appWithOwnersEnclosure();
		const other = await harness.auth.createUser(NOT_THE_OWNER);
		assert(other.ok, "the other reader should be created");
		const agent = await signIn(NOT_THE_OWNER);

		const response = await agent
			.get(`/queue/${AUDIO_ID}/view`)
			.set(BROWSER_REQUEST_HEADERS);

		expect(documentOf(response.text).querySelector("audio")).toBeNull();
		expect(response.text).not.toContain("min listen");
	});

	it.each([
		["reader", "reader"],
		["summary", "summary"],
	])("labels the header the %s poll swaps in with the listen time", async (_label, fragment) => {
		const { signIn } = await appWithOwnersEnclosure();
		const agent = await signIn(OWNER);

		const owned = await agent
			.get(`/queue/${AUDIO_ID}/${fragment}?poll=1`)
			.set(BROWSER_REQUEST_HEADERS);
		const link = await agent
			.get(`/queue/${LINK_ID}/${fragment}?poll=1`)
			.set(BROWSER_REQUEST_HEADERS);

		expect([headerReadTime(owned.text), headerReadTime(link.text)]).toEqual([
			"47 min listen",
			"3 min read",
		]);
	});
});

describe("an owned enclosure on the readlist", () => {
	it("labels the card with the listen time and a link with its read time", async () => {
		const { signIn } = await appWithOwnersEnclosure();
		const agent = await signIn(OWNER);

		const response = await agent.get("/queue").set(BROWSER_REQUEST_HEADERS);

		expect([
			cardReadTime(response.text, AUDIO_ID),
			cardReadTime(response.text, LINK_ID),
		]).toEqual(["47 min listen", "3 min read"]);
	});

	it("labels the card fragment with the listen time", async () => {
		const { signIn } = await appWithOwnersEnclosure();
		const agent = await signIn(OWNER);

		const response = await agent
			.get(`/queue/${AUDIO_ID}/card`)
			.set(BROWSER_REQUEST_HEADERS);

		expect(cardReadTime(response.text, AUDIO_ID)).toBe("47 min listen");
	});

	it("gives the Siren entity the duration and the listen time, and a link none", async () => {
		const { harness, ownerToken } = await appWithOwnersEnclosure();
		const token = await ownerToken();

		const response = await request(harness.server)
			.get("/queue")
			.set("Authorization", `Bearer ${token}`)
			.set("Accept", SIREN_MEDIA_TYPE);

		const byUrl = new Map(
			SirenCollection.parse(response.body).entities.map((entity) => [
				entity.properties.url,
				entity.properties,
			]),
		);
		expect(byUrl.get(AUDIO_URL)).toMatchObject({
			readTime: { label: "47 min listen" },
			durationSeconds: 2820,
			mediaKind: null,
		});
		expect(byUrl.get(LINK_URL)).toMatchObject({
			readTime: { label: "3 min read" },
			durationSeconds: null,
			mediaKind: null,
		});
	});
});
