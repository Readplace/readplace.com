import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { EmailLinkOrdinalSchema, type InboxEmailLinkEntry } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();
const SK = "2026-06-24T09:00:00.000Z#<row@x>";
const LINK_URL = "https://sponsor.example.com/deal";

function link(userId: UserId, overrides: Partial<InboxEmailLinkEntry> = {}): InboxEmailLinkEntry {
	return {
		userId,
		receivedAtMessageId: SK,
		ordinal: EmailLinkOrdinalSchema.parse("0000"),
		url: LINK_URL,
		resolvedUrl: undefined,
		status: "skipped",
		title: undefined,
		excerpt: undefined,
		siteName: undefined,
		imageUrl: undefined,
		failureReason: undefined,
		skipReason: "llm-ad",
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

const rowPath = `/inbox/${encodeURIComponent(SK)}/links/0000/excluded`;

function rows(html: string): Element[] {
	return Array.from(
		new JSDOM(html).window.document.querySelectorAll("[data-test-inbox-excluded-link]"),
	);
}

function onlyRow(html: string): Element {
	const [row, ...rest] = rows(html);
	assert(row, "the skipped row fragment must render");
	assert.equal(rest.length, 0, "the fragment carries exactly one row");
	return row;
}

function saveButton(row: Element): Element {
	const button = row.querySelector("[data-test-inbox-excluded-save]");
	assert(button, "a saveable skipped row must offer its save button");
	return button;
}

describe("Inbox skipped row fragment route", () => {
	it("returns 404 for an unknown link", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(rowPath);

		expect(response.status).toBe(404);
	});

	it("returns 404 for a kept link, which renders only as a live card", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, { status: "crawled", title: "A kept article", skipReason: undefined });

		const response = await agent.get(rowPath);

		expect(response.status).toBe(404);
	});

	it("returns 404 for a malformed ordinal without touching the store", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const response = await agent.get(
			`/inbox/${encodeURIComponent(SK)}/links/not-an-ordinal/excluded`,
		);

		expect(response.status).toBe(404);
	});

	it("returns one still-saving row that advances its own poll cursor", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const response = await agent.get(`${rowPath}?poll=3`);

		expect(response.status).toBe(200);
		const row = onlyRow(response.text);
		expect(row.getAttribute("id")).toBe("inbox-skipped-0000");
		expect(row.getAttribute("hx-get")).toMatch(/poll=4(?:&|$)/);
		expect(row.getAttribute("hx-trigger")).toBe("every 3s");
		expect(row.getAttribute("hx-target")).toBe("this");
		expect(row.getAttribute("hx-swap")).toBe("outerHTML");
		const button = saveButton(row);
		expect(button.getAttribute("data-test-save-state")).toBe("saving");
		expect(button.textContent?.trim()).toBe("Saving…");
	});

	it("treats a junk poll cursor as the start of the budget instead of polling unbounded", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const response = await agent.get(`${rowPath}?poll=not-a-number`);

		expect(onlyRow(response.text).getAttribute("hx-get")).toMatch(/poll=1(?:&|$)/);
	});

	it("gives up on Saving… once the settle budget is spent", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const response = await agent.get(`${rowPath}?poll=20`);

		expect(response.status).toBe(200);
		const row = onlyRow(response.text);
		expect(row.hasAttribute("hx-get")).toBe(false);
		expect(row.hasAttribute("hx-trigger")).toBe(false);
		expect(saveButton(row).getAttribute("data-test-save-state")).toBe("unsaved");
	});

	it("swaps in the saved button and announces it once the save lands", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture);
		await fixture.inboxEmail.inboxSavedLinkStore.markLinkSaved({ userId, url: LINK_URL });

		const response = await agent.get(`${rowPath}?poll=3`);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const row = onlyRow(response.text);
		expect(row.hasAttribute("hx-get")).toBe(false);
		const button = saveButton(row);
		expect(button.getAttribute("data-test-save-state")).toBe("saved");
		expect(button.textContent?.trim()).toBe("Save again");
		const live = doc.querySelector("[data-test-inbox-live-status]");
		assert(live, "a settled save must carry the out-of-band announcement");
		expect(live.getAttribute("hx-swap-oob")).toBe("innerHTML");
		expect(live.textContent).toBe(`Saved to your queue: ${LINK_URL}`);
	});

	it("offers the save again and announces the outcome once the save is recorded as failed", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture);
		await fixture.inboxEmail.inboxSavedLinkStore.markLinkSaveFailed({ userId, url: LINK_URL });

		const response = await agent.get(`${rowPath}?poll=3`);

		const row = onlyRow(response.text);
		expect(row.hasAttribute("hx-get")).toBe(false);
		const button = saveButton(row);
		expect(button.getAttribute("data-test-save-state")).toBe("unsaved");
		expect(button.textContent?.trim()).toBe("Save to queue");
		const live = new JSDOM(response.text).window.document.querySelector(
			"[data-test-inbox-live-status]",
		);
		assert(live, "a settled failure must carry the out-of-band announcement");
		expect(live.textContent).toBe(`Couldn't save ${LINK_URL}`);
	});

	it("sends no announcement while the save is still settling, so repeat ticks stay silent", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const response = await agent.get(`${rowPath}?poll=3`);

		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelectorAll("[data-test-inbox-live-status]").length).toBe(0);
		expect(rows(response.text)).toHaveLength(1);
	});

	it("revalidates with a 304 while nothing about the row has changed", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const first = await agent.get(rowPath);
		const etag = first.headers.etag;
		assert(etag, "the row response must carry an ETag");

		const second = await agent.get(rowPath).set("If-None-Match", etag);

		expect(first.headers["cache-control"]).toBe("private, no-cache");
		expect(first.headers.vary).toBe("Cookie");
		expect(second.status).toBe(304);
	});

	it("serves a fresh row rather than a 304 when the save lands after the reader's last tick", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture);

		const first = await agent.get(rowPath);
		const etag = first.headers.etag;
		assert(etag, "the row response must carry an ETag");
		await fixture.inboxEmail.inboxSavedLinkStore.markLinkSaved({ userId, url: LINK_URL });

		const second = await agent.get(rowPath).set("If-None-Match", etag);

		expect(second.status).toBe(200);
		expect(saveButton(onlyRow(second.text)).getAttribute("data-test-save-state")).toBe("saved");
	});

	it("serves the same row and button ids while saving and once saved, so the swap can restore focus", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture);

		const ids = (html: string) => {
			const row = onlyRow(html);
			return { row: row.getAttribute("id"), button: saveButton(row).getAttribute("id") };
		};

		const whileSaving = ids((await agent.get(`${rowPath}?poll=1`)).text);
		await fixture.inboxEmail.inboxSavedLinkStore.markLinkSaved({ userId, url: LINK_URL });
		const onceSaved = ids((await agent.get(`${rowPath}?poll=2`)).text);

		expect(whileSaving).toEqual({ row: "inbox-skipped-0000", button: "inbox-skipped-0000-save" });
		expect(onceSaved).toEqual(whileSaving);
	});
});
