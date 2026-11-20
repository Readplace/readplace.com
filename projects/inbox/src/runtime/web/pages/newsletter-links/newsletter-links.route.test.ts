import assert from "node:assert/strict";
import {
	type CountedNewsletterLinks,
	MinutesSchema,
	type SavedLinksJobAction,
	type SavedLinksJobCounts,
	SavedLinksJobIdSchema,
} from "@packages/domain/article";
import {
	emailIssueArticleUrl,
	InboxAddressSchema,
	MessageIdSchema,
} from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type { RunSavedLinksJobDetail } from "@packages/infra-components";
import {
	createDefaultTestAppFixture,
	TEST_APP_ORIGIN,
} from "@packages/test-fixtures";
import { JSDOM } from "jsdom";
import request from "supertest";
import { loginAgent, useTestServer } from "../../../test-app";

type Fixture = ReturnType<typeof createDefaultTestAppFixture>;

const useApp = useTestServer();
const useFailingPublishApp = useTestServer({
	publishRunSavedLinksJob: async () => {
		throw new Error("bus unavailable");
	},
});
const ONE_DAY_MS = 86_400_000;
const REQUESTED_AT = new Date("2026-11-20T01:00:00.000Z");
const COUNT_JOB_ID = SavedLinksJobIdSchema.parse(
	"2026-11-20T01:00:00.000Z-count",
);
const COUNT_CUTOFF = new Date("2026-11-20T01:00:00.000Z");
const REMOVE_PATH = "/inbox/newsletter-links/remove";
const COUNT_PATH = "/inbox/newsletter-links/count";

async function readerId(fixture: Fixture): Promise<UserId> {
	const user = await fixture.auth.findUserByEmail("test@example.com");
	assert(user, "logged-in user must exist before seeding");
	return user.userId;
}

async function seedEmail(fixture: Fixture, userId: UserId): Promise<void> {
	const messageId = MessageIdSchema.parse("msg-1");
	const receivedAt = "2026-11-19T00:00:00.000Z";
	await fixture.inboxEmail.inboxEmailStore.putEmail({
		userId,
		recipientAddress: InboxAddressSchema.parse("in-3f9a2c@read.place"),
		senderEmail: "news@example.com",
		subject: "A subject",
		status: "received",
		rawEmailS3Key: `inbound/${messageId}`,
		bodyS3Key: `content/${messageId}/content.html`,
		linkCounts: undefined,
		messageId,
		receivedAt,
		receivedAtMessageId: `${receivedAt}#${messageId}`,
	});
}

async function seedEmailSave(
	fixture: Fixture,
	params: { userId: UserId; url: string },
): Promise<void> {
	await fixture.articleStore.saveArticle({
		userId: params.userId,
		url: params.url,
		metadata: {
			title: "Post",
			siteName: "example.com",
			excerpt: "",
			wordCount: 100,
		},
		estimatedReadTime: MinutesSchema.parse(1),
		provenance: { kind: "email", senderEmail: "dan@tldr.tech" },
		savedAt: new Date("2026-11-18T00:00:00.000Z"),
		saveTrigger: "automatic",
	});
}

async function seedJob(
	fixture: Fixture,
	params: {
		userId: UserId;
		action: SavedLinksJobAction;
		finish?: { state: "completed" | "failed"; counts: SavedLinksJobCounts };
		counted?: CountedNewsletterLinks;
	},
): Promise<void> {
	const jobId =
		params.action === "count"
			? COUNT_JOB_ID
			: SavedLinksJobIdSchema.parse(`2026-11-20-${params.action}`);
	const claim = await fixture.articleStore.requestSavedLinksJob({
		userId: params.userId,
		jobId,
		action: params.action,
		requestedAt: REQUESTED_AT,
	});
	assert.equal(claim.outcome, "claimed");
	if (params.counted) {
		await fixture.articleStore.recordCountedNewsletterLinks({
			userId: params.userId,
			jobId,
			counted: params.counted,
		});
	}
	if (params.finish) {
		await fixture.articleStore.finishSavedLinksJob({
			userId: params.userId,
			jobId,
			state: params.finish.state,
			counts: params.finish.counts,
			finishedAt: new Date("2026-11-20T01:05:00.000Z"),
		});
	}
}

function counted(
	overrides: Partial<CountedNewsletterLinks["summary"]> & {
		issues?: number;
	} = {},
): CountedNewsletterLinks {
	const { issues, ...summary } = overrides;
	return {
		cutoff: COUNT_CUTOFF,
		issues: issues ?? 2,
		summary: {
			selected: 5,
			bySender: [
				{ senderEmail: "small@example.com", count: 1 },
				{ senderEmail: "big@example.com", count: 4 },
			],
			skipped: {
				read: 0,
				opened: 0,
				highlighted: 0,
				changed: 0,
				unreadable: 0,
			},
			earliestEmailSave: new Date("2026-10-01T00:00:00.000Z"),
			savedBeforeMarker: 0,
			...summary,
		},
	};
}

async function seedCounted(
	fixture: Fixture,
	userId: UserId,
	value: CountedNewsletterLinks,
): Promise<void> {
	await seedJob(fixture, {
		userId,
		action: "count",
		counted: value,
		finish: { state: "completed", counts: {} },
	});
}

function documentOf(html: string): Document {
	return new JSDOM(html).window.document;
}

function lineOf(doc: Document): Element | null {
	return doc.querySelector("[data-test-newsletter-links-line]");
}

function sentencesOf(element: Element): (string | null)[] {
	return Array.from(
		element.querySelectorAll("[data-test-newsletter-links-sentence]"),
	).map((el) => el.textContent);
}

function textsOf(doc: Document, selector: string): (string | null)[] {
	return Array.from(doc.querySelectorAll(selector)).map((el) => el.textContent);
}

function removeForm(params: {
	count: string;
	senders: string;
	sender?: string[];
}): string {
	const body = new URLSearchParams({
		count: params.count,
		senders: params.senders,
	});
	for (const sender of params.sender ?? []) body.append("sender", sender);
	return body.toString();
}

describe("Newsletter links line on the inbox", () => {
	it("is hidden when the inbox holds no mail, even with newsletter links in All", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seedEmailSave(fixture, {
			userId: await readerId(fixture),
			url: "https://a.com/post",
		});

		const doc = documentOf((await agent.get("/inbox")).text);

		expect(lineOf(doc)).toBeNull();
	});

	it("is hidden when the inbox holds mail but All holds no newsletter link", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seedEmail(fixture, await readerId(fixture));

		const doc = documentOf((await agent.get("/inbox")).text);

		expect(lineOf(doc)).toBeNull();
	});

	it("is hidden when All holds only newsletter issues", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await readerId(fixture);
		await seedEmail(fixture, userId);
		await seedEmailSave(fixture, {
			userId,
			url: emailIssueArticleUrl({
				userId,
				receivedAtMessageId: "2026-11-19T00:00:00.000Z#msg-1",
			}),
		});

		const doc = documentOf((await agent.get("/inbox")).text);

		expect(lineOf(doc)).toBeNull();
	});

	it("is hidden on a later inbox page, even when it holds mail and All holds a newsletter link", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await readerId(fixture);
		await seedEmail(fixture, userId);
		await seedEmailSave(fixture, { userId, url: "https://a.com/post" });

		const doc = documentOf(
			(
				await agent
					.get("/inbox")
					.query({ older: "2026-11-20T00:00:00.000Z#msg-2" })
			).text,
		);

		expect(doc.querySelectorAll("[data-test-inbox-emails-row]")).toHaveLength(1);
		expect(lineOf(doc)).toBeNull();
	});

	it("offers to remove newsletter links when the inbox holds mail and All holds one", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await readerId(fixture);
		await seedEmail(fixture, userId);
		await seedEmailSave(fixture, { userId, url: "https://a.com/post" });

		const doc = documentOf((await agent.get("/inbox")).text);

		const line = lineOf(doc);
		assert(line, "the offer line must render");
		expect(line.getAttribute("data-newsletter-links-state")).toBe("offer");
		expect(sentencesOf(line)).toEqual([
			"All holds links saved from your newsletters.",
		]);
		expect(line.hasAttribute("hx-get")).toBe(false);
		const form = line.querySelector("form");
		assert(form, "the offer carries the Remove button");
		const action = new URL(form.getAttribute("action") ?? "", TEST_APP_ORIGIN);
		expect(form.getAttribute("method")).toBe("POST");
		expect(action.pathname).toBe(COUNT_PATH);
		expect(action.searchParams.get("utm_source")).toBe("inbox-emails");
		expect(action.searchParams.get("utm_content")).toBe(
			"remove-newsletter-links",
		);
	});

	it("shows a working line that polls the inbox every 3 seconds while a removal runs", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await readerId(fixture);
		await seedEmail(fixture, userId);
		await seedJob(fixture, { userId, action: "remove" });

		const doc = documentOf((await agent.get("/inbox")).text);

		const line = lineOf(doc);
		assert(line, "the working line must render");
		expect(line.getAttribute("data-newsletter-links-state")).toBe("working");
		expect(sentencesOf(line)).toEqual(["Removing newsletter links from All…"]);
		expect(line.getAttribute("hx-get")).toBe("/inbox");
		expect(line.getAttribute("hx-trigger")).toBe("every 3s");
		expect(line.getAttribute("hx-select")).toBe("#newsletter-links-line");
		expect(line.querySelector("form")).toBeNull();
	});

	it("ends the pending state on the first poll that sees the removal finished", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await readerId(fixture);
		await seedEmail(fixture, userId);
		await seedJob(fixture, {
			userId,
			action: "remove",
			finish: { state: "completed", counts: { held: 3, read: 1, changed: 1 } },
		});

		const doc = documentOf(
			(await agent.get("/inbox").set("HX-Request", "true")).text,
		);

		const line = lineOf(doc);
		assert(line, "the result line must render");
		expect(line.getAttribute("data-newsletter-links-state")).toBe("result");
		expect(line.hasAttribute("hx-get")).toBe(false);
		expect(sentencesOf(line)).toEqual([
			"Removed 3 newsletter links from All.",
			"Skipped 2 links you read, opened, highlighted or saved again.",
			"Later emails from these newsletters still save their links to All. To stop that, stop forwarding the newsletter, disable its custom email, or for a Gmail newsletter change “What to save”.",
		]);
		expect(line.querySelector("form")).toBeNull();
	});

	it("names one removed link without a skipped sentence, and offers again while a newsletter link remains", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await readerId(fixture);
		await seedEmail(fixture, userId);
		await seedEmailSave(fixture, { userId, url: "https://a.com/later" });
		await seedJob(fixture, {
			userId,
			action: "remove",
			finish: { state: "completed", counts: { held: 1 } },
		});

		const line = lineOf(documentOf((await agent.get("/inbox")).text));

		assert(line, "the result line must render");
		expect(sentencesOf(line).slice(0, 2)).toEqual([
			"Removed 1 newsletter link from All.",
			"Later emails from these newsletters still save their links to All. To stop that, stop forwarding the newsletter, disable its custom email, or for a Gmail newsletter change “What to save”.",
		]);
		expect(
			line.querySelector("[data-test-newsletter-links-remove]"),
		).not.toBeNull();
	});

	it("reports a removal that held nothing as zero links removed", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await readerId(fixture);
		await seedEmail(fixture, userId);
		await seedJob(fixture, {
			userId,
			action: "remove",
			finish: { state: "completed", counts: {} },
		});

		const line = lineOf(documentOf((await agent.get("/inbox")).text));

		assert(line, "the result line must render");
		expect(sentencesOf(line)[0]).toBe("Removed 0 newsletter links from All.");
	});

	it("reports a restore with the links that could not be restored", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await readerId(fixture);
		await seedEmail(fixture, userId);
		await seedJob(fixture, {
			userId,
			action: "restore",
			finish: { state: "completed", counts: { restored: 4, unrestorable: 1 } },
		});

		const line = lineOf(documentOf((await agent.get("/inbox")).text));

		assert(line, "the result line must render");
		expect(sentencesOf(line)).toEqual([
			"Restored 4 links to All.",
			"1 link could not be restored.",
		]);
	});

	it("reports a restore with nothing unrestorable in one sentence", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await readerId(fixture);
		await seedEmail(fixture, userId);
		await seedJob(fixture, {
			userId,
			action: "restore",
			finish: { state: "completed", counts: {} },
		});

		const line = lineOf(documentOf((await agent.get("/inbox")).text));

		assert(line, "the result line must render");
		expect(sentencesOf(line)).toEqual(["Restored 0 links to All."]);
	});

	it("says a failed removal can be restored, and offers again while a newsletter link remains", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await readerId(fixture);
		await seedEmail(fixture, userId);
		await seedEmailSave(fixture, { userId, url: "https://a.com/post" });
		await seedJob(fixture, {
			userId,
			action: "remove",
			finish: { state: "failed", counts: { held: 2 } },
		});

		const line = lineOf(documentOf((await agent.get("/inbox")).text));

		assert(line, "the failed line must render");
		expect(line.getAttribute("data-newsletter-links-state")).toBe("failed");
		expect(sentencesOf(line)).toEqual([
			"Couldn't finish removing newsletter links. Links already removed can be restored for 30 days.",
		]);
		expect(
			line.querySelector("[data-test-newsletter-links-remove]"),
		).not.toBeNull();
	});

	it("says a failed restore failed without offering when no newsletter link is left", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await readerId(fixture);
		await seedEmail(fixture, userId);
		await seedJob(fixture, {
			userId,
			action: "restore",
			finish: { state: "failed", counts: {} },
		});

		const line = lineOf(documentOf((await agent.get("/inbox")).text));

		assert(line, "the failed line must render");
		expect(sentencesOf(line)).toEqual([
			"Couldn't finish restoring removed links.",
		]);
		expect(line.querySelector("form")).toBeNull();
	});
});

describe("Newsletter links confirm page", () => {
	it("redirects a signed-out visitor to sign in", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get(REMOVE_PATH);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});

	it("offers to count when nothing has been counted", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(REMOVE_PATH);

		expect(response.status).toBe(200);
		const doc = documentOf(response.text);
		expect(
			doc.querySelector('meta[name="robots"]')?.getAttribute("content"),
		).toBe("noindex, nofollow");
		expect(
			doc
				.querySelector("[data-test-newsletter-links-count]")
				?.getAttribute("data-newsletter-links-count"),
		).toBe("none");
		expect(textsOf(doc, "[data-test-newsletter-links-count-message]")).toEqual([
			"Count the newsletter links in All to see what would be removed.",
		]);
		expect(textsOf(doc, "[data-test-newsletter-links-count-button]")).toEqual([
			"Count newsletter links",
		]);
		const form = doc
			.querySelector("[data-test-newsletter-links-count-button]")
			?.closest("form");
		const action = new URL(form?.getAttribute("action") ?? "", TEST_APP_ORIGIN);
		expect(action.pathname).toBe(COUNT_PATH);
		expect(action.searchParams.get("utm_source")).toBe("newsletter-links");
		expect(action.searchParams.get("utm_content")).toBe("count");
	});

	it("polls every 3 seconds with a no-script link while the count runs", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seedJob(fixture, {
			userId: await readerId(fixture),
			action: "count",
		});

		const doc = documentOf((await agent.get(REMOVE_PATH)).text);

		const section = doc.querySelector("[data-test-newsletter-links-count]");
		assert(section, "the count section must render");
		expect(section.getAttribute("data-newsletter-links-count")).toBe(
			"counting",
		);
		expect(section.getAttribute("hx-get")).toBe(REMOVE_PATH);
		expect(section.getAttribute("hx-trigger")).toBe("every 3s");
		expect(section.getAttribute("hx-select")).toBe("#newsletter-links-count");
		const link = new URL(
			doc
				.querySelector("[data-test-newsletter-links-check-again]")
				?.getAttribute("href") ?? "",
			TEST_APP_ORIGIN,
		);
		expect(link.pathname).toBe(REMOVE_PATH);
		expect(link.searchParams.get("utm_content")).toBe("check-again");
	});

	it("ends the pending state on the first poll that sees the count, showing its numbers", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seedCounted(
			fixture,
			await readerId(fixture),
			counted({
				skipped: {
					read: 2,
					opened: 0,
					highlighted: 1,
					changed: 0,
					unreadable: 0,
				},
				savedBeforeMarker: 3,
			}),
		);

		const doc = documentOf(
			(await agent.get(REMOVE_PATH).set("HX-Request", "true")).text,
		);

		const section = doc.querySelector("[data-test-newsletter-links-count]");
		assert(section, "the count section must render");
		expect(section.getAttribute("data-newsletter-links-count")).toBe("counted");
		expect(section.hasAttribute("hx-get")).toBe(false);
		expect(textsOf(doc, "[data-test-newsletter-links-total]")).toEqual([
			"5 unread newsletter links in All will be removed.",
		]);
		expect(textsOf(doc, "[data-test-newsletter-links-skipped]")).toEqual([
			"3 links will be skipped:",
			"2 you read",
			"1 you highlighted",
		]);
		expect(textsOf(doc, "[data-test-newsletter-links-issues]")).toEqual([
			"All holds 2 newsletter issues. Every one stays.",
		]);
		expect(
			doc.querySelector("[data-test-newsletter-links-before-marker]"),
		).not.toBeNull();
		expect(textsOf(doc, "[data-test-newsletter-links-restore-window]")).toEqual(
			["Removed links can be restored for 30 days."],
		);
		expect(
			textsOf(doc, "[data-test-newsletter-links-restore-needs-plan]"),
		).toEqual([
			"Restoring them is part of a paid plan: if your plan ends, renew it within those 30 days or the removed links expire.",
		]);
		expect(
			Array.from(
				doc.querySelectorAll("[data-test-newsletter-links-sender]"),
			).map((el) => el.getAttribute("value")),
		).toEqual(["big@example.com", "small@example.com"]);
		const form = doc.querySelector("[data-test-newsletter-links-remove-form]");
		assert(form, "the remove form must render");
		expect(
			form.querySelector('input[name="count"]')?.getAttribute("value"),
		).toBe(COUNT_JOB_ID);
		const action = new URL(form.getAttribute("action") ?? "", TEST_APP_ORIGIN);
		expect(action.pathname).toBe(REMOVE_PATH);
		expect(action.searchParams.get("utm_content")).toBe("remove");
	});

	it("leaves out skipped lines, the marker sentence and the form when nothing would be removed", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seedCounted(
			fixture,
			await readerId(fixture),
			counted({ selected: 0, bySender: [], issues: 1 }),
		);

		const doc = documentOf((await agent.get(REMOVE_PATH)).text);

		expect(textsOf(doc, "[data-test-newsletter-links-total]")).toEqual([
			"0 unread newsletter links in All will be removed.",
		]);
		expect(textsOf(doc, "[data-test-newsletter-links-issues]")).toEqual([
			"All holds 1 newsletter issue. It stays.",
		]);
		expect(
			doc.querySelector("[data-test-newsletter-links-skipped]"),
		).toBeNull();
		expect(
			doc.querySelector("[data-test-newsletter-links-before-marker]"),
		).toBeNull();
		expect(
			doc.querySelector("[data-test-newsletter-links-remove-form]"),
		).toBeNull();
	});

	it("offers to try again when the count failed", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seedJob(fixture, {
			userId: await readerId(fixture),
			action: "count",
			finish: { state: "failed", counts: {} },
		});

		const doc = documentOf((await agent.get(REMOVE_PATH)).text);

		expect(textsOf(doc, "[data-test-newsletter-links-count-message]")).toEqual([
			"Couldn't count the newsletter links in All.",
		]);
		expect(textsOf(doc, "[data-test-newsletter-links-count-button]")).toEqual([
			"Try again",
		]);
	});

	it("sends the reader back to the inbox while a removal runs", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seedJob(fixture, {
			userId: await readerId(fixture),
			action: "remove",
		});

		const response = await agent.get(REMOVE_PATH);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/inbox");
	});

	it("tells a polling page to load the inbox while a removal runs", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seedJob(fixture, {
			userId: await readerId(fixture),
			action: "remove",
		});

		const response = await agent.get(REMOVE_PATH).set("HX-Request", "true");

		expect(response.status).toBe(204);
		expect(response.headers["hx-redirect"]).toBe("/inbox");
	});
});

describe("Counting newsletter links", () => {
	it("claims a count job, publishes it once and sends the reader to the confirm page", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await readerId(fixture);

		const response = await agent.post(COUNT_PATH);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(REMOVE_PATH);
		expect(harness.savedLinksJobCommands).toHaveLength(1);
		const [command] = harness.savedLinksJobCommands;
		assert(command, "one command must be published");
		expect(command.userId).toBe(userId);
		expect(command.job).toEqual({ action: "count" });
		const job = await fixture.articleStore.findSavedLinksJob({ userId });
		expect(job?.jobId).toBe(command.jobId);
		expect(job?.requestedAt.toISOString()).toBe(command.requestedAt);
	});

	it("replaces a running count with a new job, publishing each job once", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await readerId(fixture);
		await seedJob(fixture, { userId, action: "count" });

		await agent.post(COUNT_PATH);
		await agent.post(COUNT_PATH);

		const jobIds = harness.savedLinksJobCommands.map(
			(command) => command.jobId,
		);
		expect(jobIds).toHaveLength(2);
		expect(new Set(jobIds).size).toBe(2);
		expect(
			(await fixture.articleStore.findSavedLinksJob({ userId }))?.jobId,
		).toBe(jobIds[1]);
	});

	it("publishes nothing and returns to the inbox while a removal runs", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seedJob(fixture, {
			userId: await readerId(fixture),
			action: "remove",
		});

		const response = await agent.post(COUNT_PATH);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/inbox");
		expect(harness.savedLinksJobCommands).toEqual([]);
	});

	it("withdraws the claim when the command cannot be published", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useFailingPublishApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post(COUNT_PATH);

		expect(response.status).toBe(500);
		expect(
			await fixture.articleStore.findSavedLinksJob({
				userId: await readerId(fixture),
			}),
		).toBeUndefined();
	});
});

describe("Removing newsletter links", () => {
	it("removes from every newsletter at the counted cutoff, not a posted one, and returns to the inbox", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await readerId(fixture);
		await seedCounted(fixture, userId, counted());

		const response = await agent
			.post(REMOVE_PATH)
			.type("form")
			.send(
				`${removeForm({ count: COUNT_JOB_ID, senders: "all" })}&cutoff=2030-01-01T00%3A00%3A00.000Z`,
			);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/inbox");
		expect(
			harness.savedLinksJobCommands.map(
				(command: RunSavedLinksJobDetail) => command.job,
			),
		).toEqual([
			{
				action: "remove",
				cutoff: COUNT_CUTOFF.toISOString(),
				senders: { kind: "all" },
			},
		]);
		expect(
			(await fixture.articleStore.findSavedLinksJob({ userId }))?.action,
		).toBe("remove");
	});

	it("removes only from the ticked newsletters", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seedCounted(fixture, await readerId(fixture), counted());

		const response = await agent
			.post(REMOVE_PATH)
			.type("form")
			.send(
				removeForm({
					count: COUNT_JOB_ID,
					senders: "chosen",
					sender: ["big@example.com", "small@example.com"],
				}),
			);

		expect(response.status).toBe(303);
		expect(harness.savedLinksJobCommands.map((command) => command.job)).toEqual(
			[
				{
					action: "remove",
					cutoff: COUNT_CUTOFF.toISOString(),
					senders: {
						kind: "chosen",
						senderEmails: ["big@example.com", "small@example.com"],
					},
				},
			],
		);
	});

	it.each([
		[
			"a count the page did not show",
			removeForm({ count: "2026-11-19T00:00:00.000Z-older", senders: "all" }),
		],
		[
			"no newsletter ticked",
			removeForm({ count: COUNT_JOB_ID, senders: "chosen" }),
		],
		[
			"a newsletter the count did not list",
			removeForm({
				count: COUNT_JOB_ID,
				senders: "chosen",
				sender: ["big@example.com", "other@example.com"],
			}),
		],
		[
			"every newsletter chosen with newsletters ticked",
			removeForm({
				count: COUNT_JOB_ID,
				senders: "all",
				sender: ["big@example.com"],
			}),
		],
		["a malformed form", "count=&senders=some"],
	])("sends the reader back to the confirm page for %s", async (_case, body) => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seedCounted(fixture, await readerId(fixture), counted());

		const response = await agent.post(REMOVE_PATH).type("form").send(body);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(REMOVE_PATH);
		expect(harness.savedLinksJobCommands).toEqual([]);
	});

	it("sends the reader back to the confirm page when nothing has been counted", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.post(REMOVE_PATH)
			.type("form")
			.send(removeForm({ count: COUNT_JOB_ID, senders: "all" }));

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(REMOVE_PATH);
		expect(harness.savedLinksJobCommands).toEqual([]);
	});

	it("refuses a free account and publishes nothing", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await readerId(fixture);
		await seedCounted(fixture, userId, counted());
		await harness.subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub_cancelled",
			customerId: "cus_cancelled",
		});
		await harness.subscriptionProviders.markCancelledByUserId({ userId });

		const response = await agent
			.post(REMOVE_PATH)
			.type("form")
			.send(removeForm({ count: COUNT_JOB_ID, senders: "all" }));

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account/plans");
		expect(harness.savedLinksJobCommands).toEqual([]);
	});

	it("refuses a locked account and publishes nothing", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.shared.now = () => new Date(Date.now() + 8 * ONE_DAY_MS);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seedCounted(fixture, await readerId(fixture), counted());

		const response = await agent
			.post(REMOVE_PATH)
			.set("Accept", "text/html")
			.type("form")
			.send(removeForm({ count: COUNT_JOB_ID, senders: "all" }));

		expect(response.status).toBe(403);
		expect(harness.savedLinksJobCommands).toEqual([]);
	});
});
