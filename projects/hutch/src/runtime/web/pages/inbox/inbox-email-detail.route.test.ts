import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	InboxAddressSchema,
	type InboxEmailEntry,
	type InboxEmailStatus,
	MessageIdSchema,
} from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

const SK = "2026-06-24T09:00:00.000Z#<view@x>";

function emailEntry(userId: UserId, status: InboxEmailStatus): InboxEmailEntry {
	const messageId = MessageIdSchema.parse("<view@x>");
	return {
		userId,
		receivedAtMessageId: SK,
		messageId,
		recipientAddress: InboxAddressSchema.parse("in-3f9a2c@read.place"),
		senderEmail: "news@example.com",
		subject: "Weekly digest",
		status,
		receivedAt: "2026-06-24T09:00:00.000Z",
		rawEmailS3Key: "inbound/view",
		bodyS3Key: status === "received" ? "content/view/content.html" : undefined,
	};
}

async function seed(
	fixture: ReturnType<typeof createDefaultTestAppFixture>,
	status: InboxEmailStatus,
): Promise<void> {
	const user = await fixture.auth.findUserByEmail("test@example.com");
	assert(user, "logged-in user must exist before seeding");
	await fixture.inboxEmail.inboxEmailStore.putEmail(emailEntry(user.userId, status));
}

const detailPath = `/inbox/${encodeURIComponent(SK)}?feature=email`;

describe("Inbox email detail route", () => {
	it("returns 404 without the email feature flag", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(`/inbox/${encodeURIComponent(SK)}`);

		expect(response.status).toBe(404);
	});

	it("returns 404 for an email the user does not have", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(detailPath);

		expect(response.status).toBe(404);
	});

	it("renders a received email in a hardened, script-free sandboxed View tab", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.inboxEmail.readEmailContent = async () => "<p>Sanitized newsletter body</p>";
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "received");

		const response = await agent.get(detailPath);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;

		// Both tabs render; View is the active one, Articles shows the M3 placeholder.
		const viewTab = doc.querySelector('[data-test-inbox-tab="view"]');
		const articlesTab = doc.querySelector('[data-test-inbox-tab="articles"]');
		assert(viewTab, "View tab must render");
		assert(articlesTab, "Articles tab must render");
		expect(viewTab.getAttribute("aria-current")).toBe("page");
		expect(articlesTab.getAttribute("aria-current")).toBeNull();
		expect(doc.querySelector("[data-test-inbox-articles-placeholder]")).not.toBeNull();

		// The iframe sandbox is EXACTLY the safe set — no allow-scripts, no
		// allow-same-origin — so the email document is inert and opaque.
		const iframe = doc.querySelector("[data-test-inbox-email-iframe]");
		assert(iframe, "View tab must render the iframe");
		expect(iframe.getAttribute("sandbox")).toBe(
			"allow-popups allow-popups-to-escape-sandbox",
		);

		// The srcdoc carries the restrictive CSP and the sanitized body, and no
		// script survives anywhere in the rendered page.
		const srcdoc = iframe.getAttribute("srcdoc");
		assert(srcdoc, "iframe must carry a srcdoc");
		expect(srcdoc).toContain("img-src 'self'");
		expect(srcdoc).toContain("Sanitized newsletter body");
		expect(response.text).not.toContain("<script>alert");

		expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
			"noindex, nofollow",
		);
	});

	it("shows the graceful unavailable panel for an unparsed email instead of an empty frame", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, "unparsed");

		const response = await agent.get(detailPath);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-inbox-email-unavailable]")).not.toBeNull();
		expect(doc.querySelector("[data-test-inbox-email-iframe]")).toBeNull();
		expect(doc.querySelector("[data-test-inbox-articles-placeholder]")).not.toBeNull();
	});
});
