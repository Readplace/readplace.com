import assert from "node:assert/strict";
import {
	EmailLinkOrdinalSchema,
	type InboxEmailLinkEntry,
} from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();
const SK = "2026-06-24T09:00:00.000Z#<save@x>";

function link(userId: UserId, overrides: Partial<InboxEmailLinkEntry> = {}): InboxEmailLinkEntry {
	return {
		userId,
		receivedAtMessageId: SK,
		ordinal: EmailLinkOrdinalSchema.parse("0000"),
		url: "https://example.com/post",
		resolvedUrl: undefined,
		status: "crawled",
		title: "A post",
		excerpt: undefined,
		siteName: undefined,
		imageUrl: undefined,
		failureReason: undefined,
		skipReason: undefined,
		...overrides,
	};
}

async function seed(
	fixture: ReturnType<typeof createDefaultTestAppFixture>,
	overrides: Partial<InboxEmailLinkEntry> = {},
): Promise<UserId> {
	const user = await fixture.auth.findUserByEmail("test@example.com");
	assert(user, "logged-in user must exist before seeding");
	await fixture.inboxEmail.inboxEmailLinkStore.putLink(link(user.userId, overrides));
	return user.userId;
}

const savePath = `/inbox/${encodeURIComponent(SK)}/links/0000/save?feature=email`;

describe("Inbox link save route", () => {
	it("publishes a submit for the stored link and redirects back to the Articles tab", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture);

		const response = await agent.post(savePath);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			`/inbox/${encodeURIComponent(SK)}?feature=email&tab=articles&saved=1`,
		);
		expect(harness.submittedLinks).toEqual([{ userId, url: "https://example.com/post" }]);
	});

	it("submits the stored URL even when the preview resolved elsewhere — the save pipeline owns redirects", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture, { resolvedUrl: "https://cdn.example.com/final" });

		await agent.post(savePath);

		expect(harness.submittedLinks).toEqual([{ userId, url: "https://example.com/post" }]);
	});

	it("returns 404 without the email feature flag", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const response = await agent.post(`/inbox/${encodeURIComponent(SK)}/links/0000/save`);

		expect(response.status).toBe(404);
		expect(harness.submittedLinks).toEqual([]);
	});

	it("returns 404 for an unknown link and publishes nothing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post(savePath);

		expect(response.status).toBe(404);
		expect(harness.submittedLinks).toEqual([]);
	});

	it("returns 404 for a skipped link — its row renders without a Save button", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, { status: "skipped", skipReason: "llm-ad", title: undefined });

		const response = await agent.post(savePath);

		expect(response.status).toBe(404);
		expect(harness.submittedLinks).toEqual([]);
	});

	it("returns 404 for a malformed ordinal and publishes nothing", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const response = await agent.post(
			`/inbox/${encodeURIComponent(SK)}/links/not-an-ordinal/save?feature=email`,
		);

		expect(response.status).toBe(404);
		expect(harness.submittedLinks).toEqual([]);
	});

	it("returns 404 for a link the save pipeline would reject", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, { url: "https://localhost/private" });

		const response = await agent.post(savePath);

		expect(response.status).toBe(404);
		expect(harness.submittedLinks).toEqual([]);
	});
});
