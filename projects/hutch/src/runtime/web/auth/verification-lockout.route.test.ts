import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import type { Token, Client } from "@node-oauth/oauth2-server";
import type { UserId } from "@packages/domain/user";
import { MinutesSchema } from "@packages/domain/article";
import { loginAgent, useTestServer } from "../../test-app";
import type { TestAppHarness } from "../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { SIREN_MEDIA_TYPE } from "../api/siren";

const useApp = useTestServer();
const DAY_MS = 24 * 60 * 60 * 1000;

/** A fixture whose server clock runs `days` ahead of real time, so a user
 * created now lands past the 7-day verification window without any way to
 * backdate `registeredAt` directly. */
function fixtureClockedDaysAhead(days: number) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	fixture.shared.now = () => new Date(Date.now() + days * DAY_MS);
	return fixture;
}

async function createUnverifiedUser(
	harness: TestAppHarness,
	email: string,
): Promise<UserId> {
	const created = await harness.auth.createUser({ email, password: "password123" });
	assert(created.ok, "user should be created");
	return created.userId;
}

/** Mints a bearer access token for the extension client, the way the iOS app
 * and browser extension authenticate — no session cookie, so the lock has to
 * resolve from the token's user rather than the session. */
async function mintAccessToken(
	harness: TestAppHarness,
	userId: UserId,
): Promise<string> {
	const client = await harness.oauthModel.getClient("hutch-firefox-extension", "");
	assert(client, "test OAuth client must exist");
	const token: Token = {
		accessToken: `access-${userId}`,
		accessTokenExpiresAt: new Date(Date.now() + 3600000),
		refreshToken: `refresh-${userId}`,
		refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600000),
		client: {
			id: "hutch-firefox-extension",
			grants: ["authorization_code", "refresh_token"],
			redirectUris: ["http://127.0.0.1:3000/oauth/callback"],
		} as Client,
		user: { id: userId },
	};
	const saved = await harness.oauthModel.saveToken(token, client, { id: userId });
	assert(saved, "token should be saved");
	return saved.accessToken;
}

describe("Email verification lockout", () => {
	it("shows the days-only countdown on the queue while still inside the window", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const banner = doc.querySelector("[data-test-verify-banner]");
		assert(banner, "verify banner must be rendered");
		expect(banner.getAttribute("data-verification-state")).toBe("counting-down");
		expect(banner.textContent).toContain("7 days");
		expect(banner.textContent).toContain("before your account is locked");
	});

	it("keeps the queue readable but shows the locked banner once the window lapses", async () => {
		const harness = useApp(fixtureClockedDaysAhead(8));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		assert(
			doc.querySelector("[data-test-empty-queue]"),
			"the queue list must still render while locked, not a lock wall",
		);
		expect(doc.querySelector("h1")?.textContent).not.toBe("Your account is locked");

		const banner = doc.querySelector("[data-test-verify-banner]");
		assert(banner, "verify banner must be rendered");
		expect(banner.getAttribute("data-verification-state")).toBe("locked");
	});

	it("refuses a web save with the contact-support lock screen once the window lapses", async () => {
		const harness = useApp(fixtureClockedDaysAhead(8));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.post("/queue/save")
			.type("form")
			.send({ url: "https://example.com/article" });

		expect(response.status).toBe(403);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("h1")?.textContent).toBe("Your account is locked");

		const contact = doc.querySelector(".auth-card__link");
		assert(contact, "locked screen must offer a contact link");
		expect(contact.getAttribute("href")).toBe(
			"mailto:readplace+verification@readplace.com",
		);

		const logout = doc.querySelector('form[action="/logout"]');
		assert(logout, "locked screen must keep a logout escape hatch");
		expect(logout.getAttribute("method")?.toUpperCase()).toBe("POST");
	});

	it("lets a locked account delete and mark articles as read (only new saves are gated)", async () => {
		const harness = useApp(fixtureClockedDaysAhead(8));
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		const saved = await harness.articleStore.saveArticle({
			userId,
			url: "https://example.com/already-saved",
			metadata: { title: "Already saved", siteName: "example.com", excerpt: "", wordCount: 0 },
			estimatedReadTime: MinutesSchema.parse(0),
		});

		const markRead = await agent
			.post(`/queue/${saved.id.value}/status`)
			.type("form")
			.send({ status: "read" });
		expect(markRead.status).toBe(303);

		const deleted = await agent.post(`/queue/${saved.id.value}/delete`);
		expect(deleted.status).toBe(303);

		const remaining = await harness.articleStore.findArticlesByUser({ userId });
		expect(remaining.articles).toHaveLength(0);
	});

	it("locks /import (a bulk-save tool) but reopens /export and /account for a lapsed account", async () => {
		const harness = useApp(fixtureClockedDaysAhead(8));
		const agent = await loginAgent(harness.server, harness.auth);

		const importResponse = await agent.get("/import");
		expect(importResponse.status).toBe(403);
		expect(
			new JSDOM(importResponse.text).window.document.querySelector("h1")?.textContent,
		).toBe("Your account is locked");

		for (const path of ["/export", "/account"]) {
			const response = await agent.get(path);
			expect(response.status).toBe(200);
			expect(
				new JSDOM(response.text).window.document.querySelector("h1")?.textContent,
			).not.toBe("Your account is locked");
		}
	});

	it("still lets a locked account sign out", async () => {
		const harness = useApp(fixtureClockedDaysAhead(8));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post("/logout");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/");
	});

	it("never locks a verified account, even long past the window", async () => {
		const harness = useApp(fixtureClockedDaysAhead(8));
		await harness.auth.createUser({ email: "verified@example.com", password: "password123" });
		await harness.auth.markEmailVerified("verified@example.com");

		const agent = request.agent(harness.server);
		await agent
			.post("/login")
			.type("form")
			.send({ email: "verified@example.com", password: "password123" });

		const response = await agent.get("/queue");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const banner = doc.querySelector("[data-test-verify-banner]");
		assert(banner, "verify banner must be rendered");
		expect(banner.getAttribute("data-verification-state")).toBe("verified");
		expect(banner.classList.contains("verify-banner--hidden")).toBe(true);
	});
});

describe("Email verification lockout (Siren API)", () => {
	it("refuses a locked account's Siren save with a message-only error (no action)", async () => {
		const harness = useApp(fixtureClockedDaysAhead(8));
		const userId = await createUnverifiedUser(harness, "locked-api@example.com");
		const token = await mintAccessToken(harness, userId);

		const response = await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article" });

		expect(response.status).toBe(403);
		expect(response.type).toContain("application/vnd.siren+json");
		expect(response.body.class).toContain("error");
		expect(response.body.properties.messages).toHaveLength(1);
		expect(response.body.properties.messages[0].type).toBe("warning");
		expect(response.body.properties.messages[0].content.type).toBe("text/html");
		expect(response.body.properties.messages[0].content.body).toContain(
			"readplace+verification@readplace.com",
		);
		expect(response.body.properties.code).toBeUndefined();
		expect(response.body.actions).toBeUndefined();
	});

	it("refuses a locked account's Siren save-html write too", async () => {
		const harness = useApp(fixtureClockedDaysAhead(8));
		const userId = await createUnverifiedUser(harness, "locked-html@example.com");
		const token = await mintAccessToken(harness, userId);

		const response = await request(harness.server)
			.post("/queue/save-html")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article", rawHtml: "<p>hi</p>" });

		expect(response.status).toBe(403);
		expect(response.body.properties.messages[0].content.body).toContain(
			"readplace+verification@readplace.com",
		);
	});

	it("keeps a locked account's Siren reads working (the lock gates saves, not reads)", async () => {
		const harness = useApp(fixtureClockedDaysAhead(8));
		const userId = await createUnverifiedUser(harness, "locked-read@example.com");
		const token = await mintAccessToken(harness, userId);

		const response = await request(harness.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`);

		expect(response.status).toBe(200);
		expect(response.body.class).toContain("collection");
	});

	it("lets a locked account delete an existing item via Siren (delete is not a save)", async () => {
		const harness = useApp(fixtureClockedDaysAhead(8));
		const userId = await createUnverifiedUser(harness, "locked-delete@example.com");
		const saved = await harness.articleStore.saveArticle({
			userId,
			url: "https://example.com/already-saved",
			metadata: { title: "Already saved", siteName: "example.com", excerpt: "", wordCount: 0 },
			estimatedReadTime: MinutesSchema.parse(0),
		});
		const token = await mintAccessToken(harness, userId);

		const response = await request(harness.server)
			.post(`/queue/${saved.id.value}/delete`)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.set("Prefer", "return=representation");

		expect(response.status).toBe(303);
		const remaining = await harness.articleStore.findArticlesByUser({ userId });
		expect(remaining.articles).toHaveLength(0);
	});

	it("lets an account still inside the window save via Siren", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const userId = await createUnverifiedUser(harness, "counting-down-api@example.com");
		const token = await mintAccessToken(harness, userId);

		const response = await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article" });

		expect(response.status).toBe(201);
		expect(response.body.class).toContain("article");
	});

	it("never locks a verified account's Siren save, even past the window", async () => {
		const harness = useApp(fixtureClockedDaysAhead(8));
		const userId = await createUnverifiedUser(harness, "verified-api@example.com");
		await harness.auth.markEmailVerified("verified-api@example.com");
		const token = await mintAccessToken(harness, userId);

		const response = await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article" });

		expect(response.status).toBe(201);
		expect(response.body.class).toContain("article");
	});
});
