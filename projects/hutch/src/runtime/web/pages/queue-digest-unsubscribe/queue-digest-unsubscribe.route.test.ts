import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import type { Test } from "supertest";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { BROWSER_REQUEST_HEADERS, useTestServer } from "../../../test-app";
import { initQueueDigestUnsubscribeToken } from "../../../domain/email/queue-digest-unsubscribe-token";
import { QUEUE_DIGEST_UNSUBSCRIBE_PATH } from "../../queue-digest-email";

const useApp = useTestServer();
const TEST_ANALYTICS_SALT = "test-analytics-salt";
const UNSUBSCRIBED_AT = new Date("2026-10-02T08:30:00.000Z");
const GOOGLEBOT = "Googlebot/2.1 (+http://www.google.com/bot.html)";

type Harness = ReturnType<ReturnType<typeof useTestServer>>;

async function digestReader(email: string) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	fixture.shared.now = () => UNSUBSCRIBED_AT;
	const harness = useApp(fixture);
	await harness.auth.createUser({ email, password: "password123" });
	const user = await harness.auth.findUserByEmail(email);
	assert(user, "the digest reader must exist once created");
	const token = initQueueDigestUnsubscribeToken(TEST_ANALYTICS_SALT).sign(user.userId);
	return { harness, userId: user.userId, token };
}

function unsubscribeUrl(query: Record<string, string>): string {
	return `${QUEUE_DIGEST_UNSUBSCRIBE_PATH}?${new URLSearchParams(query).toString()}`;
}

async function optOutOf(harness: Harness, userId: UserId): Promise<string | undefined> {
	const contact = await harness.auth.findUserContactByUserId(userId);
	assert(contact, "the digest reader must still have a contact");
	return contact.queueDigestOptOutAt;
}

function unsubscribes(harness: Harness) {
	return harness.analytics.events.filter((event) => event.event === "queue_digest_unsubscribed");
}

function pageState(html: string): string {
	const page = new JSDOM(html).window.document.querySelector("[data-test-queue-digest-unsubscribe]");
	assert(page, "the unsubscribe page must render");
	return page.getAttribute("data-test-queue-digest-unsubscribe") ?? "";
}

function confirmForm(html: string): HTMLFormElement {
	const form = new JSDOM(html).window.document.querySelector<HTMLFormElement>(
		"[data-test-queue-digest-unsubscribe] form",
	);
	assert(form, "the confirm page must offer a form to stop the emails");
	return form;
}

describe("GET /email/queue-digest/unsubscribe", () => {
	it("asks the reader to confirm, with one form that posts back with the same token from this page", async () => {
		const { harness, token } = await digestReader("confirm-page@example.com");

		const response = await request(harness.server).get(unsubscribeUrl({ t: token })).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(200);
		expect(pageState(response.text)).toBe("confirm");
		const form = confirmForm(response.text);
		expect(form.getAttribute("method")).toBe("POST");
		const action = new URL(form.getAttribute("action") ?? "", TEST_APP_ORIGIN);
		expect(action.pathname).toBe(QUEUE_DIGEST_UNSUBSCRIBE_PATH);
		expect(action.searchParams.get("t")).toBe(token);
		expect(action.searchParams.get("utm_source")).toBe("queue-digest-unsubscribe");
		expect(
			Array.from(form.querySelectorAll("input[type=hidden]")).map((input) => [
				input.getAttribute("name"),
				input.getAttribute("value"),
			]),
		).toEqual([["confirm", "page"]]);
	});

	it("never stops the emails on its own, since mail scanners open every link", async () => {
		const { harness, userId, token } = await digestReader("confirm-no-write@example.com");

		const response = await request(harness.server).get(unsubscribeUrl({ t: token })).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(200);
		expect(await optOutOf(harness, userId)).toBeUndefined();
		expect(unsubscribes(harness)).toEqual([]);
	});

	it("opens the same confirmation from the email footer link, which carries the digest campaign", async () => {
		const { harness, token } = await digestReader("footer-link@example.com");

		const response = await request(harness.server)
			.get(
				unsubscribeUrl({
					t: token,
					utm_source: "queue-digest",
					utm_medium: "email",
					utm_campaign: "regular",
					utm_content: "unsubscribe",
					utm_term: "msg-regular-1",
				}),
			)
			.set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(200);
		expect(pageState(response.text)).toBe("confirm");
	});

	it("keeps the page out of search results", async () => {
		const { harness, token } = await digestReader("noindex@example.com");

		const response = await request(harness.server).get(unsubscribeUrl({ t: token })).set(BROWSER_REQUEST_HEADERS);

		expect(response.headers["x-robots-tag"]).toBe("noindex");
	});

	it.each([
		["a token signed for someone else", (token: string) => ({ t: `someone-else.${token.split(".")[1]}` })],
		["a tampered signature", (token: string) => ({ t: `${token}0` })],
		["no token at all", () => ({})],
	])("refuses %s with a 400 and no form", async (_name, queryFor) => {
		const { harness, token } = await digestReader("bad-token-get@example.com");

		const response = await request(harness.server).get(unsubscribeUrl(queryFor(token))).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(400);
		expect(pageState(response.text)).toBe("invalid");
	});

	it("confirms the emails have stopped once the reader comes back from the form", async () => {
		const { harness, token } = await digestReader("done-page@example.com");

		const response = await request(harness.server)
			.get(unsubscribeUrl({ t: token, done: "1" }))
			.set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(200);
		expect(pageState(response.text)).toBe("done");
	});
});

describe("POST /email/queue-digest/unsubscribe (from the confirm page)", () => {
	it("stops the emails and sends the reader to the confirmation, so a refresh does not post again", async () => {
		const { harness, userId, token } = await digestReader("page-post@example.com");
		const page = await request(harness.server).get(unsubscribeUrl({ t: token })).set(BROWSER_REQUEST_HEADERS);

		const response = await request(harness.server)
			.post(confirmForm(page.text).getAttribute("action") ?? "")
			.set(BROWSER_REQUEST_HEADERS)
			.type("form")
			.send({ confirm: "page" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(unsubscribeUrl({ t: token, done: "1" }));
		expect(await optOutOf(harness, userId)).toBe(UNSUBSCRIBED_AT.toISOString());
		expect(unsubscribes(harness)).toEqual([
			{
				stream: "analytics",
				event: "queue_digest_unsubscribed",
				timestamp: UNSUBSCRIBED_AT.toISOString(),
				user_id: userId,
				method: "page",
			},
		]);
	});
});

describe("POST /email/queue-digest/unsubscribe (one-click from the mail client)", () => {
	it.each([
		["a form-encoded body", (post: Test) => post.type("form").send("List-Unsubscribe=One-Click")],
		["a multipart body", (post: Test) => post.field("List-Unsubscribe", "One-Click")],
		["an empty body", (post: Test) => post],
	])("stops the emails for %s and answers 200 with nothing to render, whatever the client calls itself", async (_name, withBody) => {
		const { harness, userId, token } = await digestReader("one-click@example.com");

		const response = await withBody(
			request(harness.server).post(unsubscribeUrl({ t: token })).set("User-Agent", GOOGLEBOT),
		);

		expect(response.status).toBe(200);
		expect(response.text).toBe("");
		expect(await optOutOf(harness, userId)).toBe(UNSUBSCRIBED_AT.toISOString());
		expect(unsubscribes(harness)).toEqual([
			{
				stream: "analytics",
				event: "queue_digest_unsubscribed",
				timestamp: UNSUBSCRIBED_AT.toISOString(),
				user_id: userId,
				method: "one-click",
			},
		]);
	});

	it("keeps the reader unsubscribed when the mail client posts twice", async () => {
		const { harness, userId, token } = await digestReader("one-click-twice@example.com");

		const first = await request(harness.server).post(unsubscribeUrl({ t: token })).type("form").send("List-Unsubscribe=One-Click");
		const second = await request(harness.server).post(unsubscribeUrl({ t: token })).type("form").send("List-Unsubscribe=One-Click");

		expect([first.status, second.status]).toEqual([200, 200]);
		expect(await optOutOf(harness, userId)).toBe(UNSUBSCRIBED_AT.toISOString());
	});

	it.each([
		["a token signed for someone else", (token: string) => ({ t: `someone-else.${token.split(".")[1]}` })],
		["no token at all", () => ({})],
	])("refuses %s with a 400 and stops nothing", async (_name, queryFor) => {
		const { harness, userId, token } = await digestReader("bad-token-post@example.com");

		const response = await request(harness.server)
			.post(unsubscribeUrl(queryFor(token)))
			.type("form")
			.send("List-Unsubscribe=One-Click");

		expect(response.status).toBe(400);
		expect(await optOutOf(harness, userId)).toBeUndefined();
		expect(unsubscribes(harness)).toEqual([]);
	});
});
