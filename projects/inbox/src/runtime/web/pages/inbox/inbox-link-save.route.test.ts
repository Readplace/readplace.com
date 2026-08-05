import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	EmailLinkOrdinalSchema,
	type InboxEmailEntry,
	type InboxEmailLinkEntry,
	InboxAddressSchema,
	MessageIdSchema,
} from "@packages/domain/inbox";
import { type UserId, UserIdSchema } from "@packages/domain/user";
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

function email(userId: UserId): InboxEmailEntry {
	return {
		userId,
		receivedAtMessageId: SK,
		messageId: MessageIdSchema.parse("<save@x>"),
		recipientAddress: InboxAddressSchema.parse("in-3f9a2c@read.place"),
		senderEmail: "news@example.com",
		subject: "Weekly digest",
		status: "received",
		receivedAt: "2026-06-24T09:00:00.000Z",
		rawEmailS3Key: "inbound/save",
		bodyS3Key: "content/save/content.html",
		linkCounts: undefined,
	};
}

/** Seeds the owning email as well as the link, so a test can follow the save's
 * redirect and assert on the page it lands on rather than only its Location. */
async function seed(
	fixture: ReturnType<typeof createDefaultTestAppFixture>,
	overrides: Partial<InboxEmailLinkEntry> = {},
): Promise<UserId> {
	const user = await fixture.auth.findUserByEmail("test@example.com");
	assert(user, "logged-in user must exist before seeding");
	await fixture.inboxEmail.inboxEmailStore.putEmail(email(user.userId));
	await fixture.inboxEmail.inboxEmailLinkStore.putLink(link(user.userId, overrides));
	return user.userId;
}

const savePath = `/inbox/${encodeURIComponent(SK)}/links/0000/save`;

describe("Inbox link save route", () => {
	it("publishes a submit for the stored link, reports nothing, and redirects back to the Articles tab", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const errors: string[] = [];
		fixture.shared.logError = (message) => {
			errors.push(message);
		};
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture);

		const response = await agent.post(savePath);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			`/inbox/${encodeURIComponent(SK)}?tab=articles&saved=1`,
		);
		expect(harness.submittedLinks).toEqual([{ userId, url: "https://example.com/post" }]);
		// A kept card carries no misclassification verdict, so its save logs no
		// classifier-audit line — only a skipped row's save reports one.
		expect(errors).toHaveLength(0);
	});

	it("confirms the save on the followed redirect as a dismissable status toast", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const response = await agent.post(savePath);
		const confirmation = await agent.get(response.headers.location);

		const doc = new JSDOM(confirmation.text).window.document;
		const toast = doc.querySelector("[data-test-toast]");
		assert(toast, "the followed redirect must confirm the save");
		// Present tense: the route only publishes SubmitLinkCommand — the queue row
		// is written by a downstream subscriber.
		expect(doc.querySelector("[data-test-toast-message]")?.textContent?.trim()).toBe(
			"Adding to your queue…",
		);
		// data-dismiss is what the global toast script reads to fade the toast out,
		// so a stale flag can't pin it on screen.
		expect(toast.getAttribute("role")).toBeNull();
		expect(toast.getAttribute("aria-live")).toBeNull();
		expect(toast.getAttribute("data-dismiss")).toBe("6000");
	});

	it("renders no toast on a plain view of the same page", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const plain = await agent.get(
			`/inbox/${encodeURIComponent(SK)}?tab=articles`,
		);

		expect(new JSDOM(plain.text).window.document.querySelector("[data-test-toast]")).toBe(null);
	});

	it("carries the expanded page size back so the saved card keeps its place in the list", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const response = await agent.post(savePath).type("form").send({ shown: "40" });

		expect(response.headers.location).toBe(
			`/inbox/${encodeURIComponent(SK)}?tab=articles&shown=40&saved=1`,
		);
	});

	it("submits the stored URL even when the preview resolved elsewhere — the save pipeline owns redirects", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture, { resolvedUrl: "https://cdn.example.com/final" });

		await agent.post(savePath);

		expect(harness.submittedLinks).toEqual([{ userId, url: "https://example.com/post" }]);
	});

	it("strips the newsletter's utm tags from a crawled link before submitting it", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture, {
			url: "https://example.com/post?id=7&utm_source=nl&utm_medium=email",
		});

		await agent.post(savePath);

		expect(harness.submittedLinks).toEqual([{ userId, url: "https://example.com/post?id=7" }]);
	});

	it("submits a pending wrapper byte-exact, so a signed query survives the redirect chain", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture, {
			status: "pending",
			title: undefined,
			url: "https://link.mail.example.com/ss/c/token?utm_source=nl",
		});

		await agent.post(savePath);

		expect(harness.submittedLinks).toEqual([
			{ userId, url: "https://link.mail.example.com/ss/c/token?utm_source=nl" },
		]);
	});

	it("returns 404 for an unknown link and publishes nothing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.post(savePath);

		expect(response.status).toBe(404);
		expect(harness.submittedLinks).toEqual([]);
	});

	it("saves a misclassified skipped link byte-exact, reports it, and redirects back to the Skipped tab", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const errors: string[] = [];
		fixture.shared.logError = (message) => {
			errors.push(message);
		};
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture, {
			status: "skipped",
			skipReason: "llm-ad",
			title: undefined,
			url: "https://example.com/story?utm_source=nl&sig=abc",
		});

		const response = await agent.post(savePath);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			`/inbox/${encodeURIComponent(SK)}?tab=excluded&saved=1`,
		);
		expect(harness.submittedLinks).toEqual([
			{ userId, url: "https://example.com/story?utm_source=nl&sig=abc" },
		]);
		// Saving a skipped row IS the report now that the report button is gone: the
		// save emits the same classifier-audit line the button used to, so a
		// misclassification still reaches the operator's error widget.
		expect(errors).toHaveLength(1);
		assert(errors[0].startsWith("[inbox-link-feedback] "));
		const feedback = JSON.parse(errors[0].slice("[inbox-link-feedback] ".length));
		expect(feedback).toMatchObject({
			verdict: "should-be-included",
			receivedAtMessageId: SK,
			ordinal: "0000",
			url: "https://example.com/story?utm_source=nl&sig=abc",
			status: "skipped",
			skipReason: "llm-ad",
		});
		expect(feedback).not.toHaveProperty("userId");
	});

	it("returns 404 for a skipped link the save pipeline would reject, publishing nothing", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, {
			status: "skipped",
			skipReason: "list-unsubscribe",
			title: undefined,
			url: "https://localhost/private",
		});

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
			`/inbox/${encodeURIComponent(SK)}/links/not-an-ordinal/save`,
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

describe("Inbox link save route answering htmx in place", () => {
	let settlingFixture: ReturnType<typeof createDefaultTestAppFixture> | undefined;
	const useSettlingApp = useTestServer({
		publishSubmitLink: async ({ userId, url }) => {
			assert(settlingFixture, "the settling fixture must be built before the save");
			await settlingFixture.inboxEmail.inboxSavedLinkStore.markLinkSaved({
				userId: UserIdSchema.parse(userId),
				url,
			});
		},
	});

	const skipped = {
		status: "skipped",
		skipReason: "llm-ad",
		title: undefined,
	} satisfies Partial<InboxEmailLinkEntry>;

	function excludedRow(html: string): Element {
		const doc = new JSDOM(html).window.document;
		const rows = doc.querySelectorAll("[data-test-inbox-excluded-link]");
		assert.equal(rows.length, 1, "the response carries exactly one skipped row");
		const row = rows[0];
		assert(row, "the skipped row must render");
		return row;
	}

	function saveButton(row: Element): Element {
		const button = row.querySelector("[data-test-inbox-excluded-save]");
		assert(button, "the skipped row must keep offering its save button");
		return button;
	}

	it("answers a non-boosted htmx save with the row itself, saving and polling for the settle", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const errors: string[] = [];
		fixture.shared.logError = (message) => {
			errors.push(message);
		};
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture, skipped);

		const response = await agent.post(savePath).set("HX-Request", "true");

		expect(response.status).toBe(200);
		const row = excludedRow(response.text);
		expect(row.getAttribute("id")).toBe("inbox-skipped-0000");
		expect(row.getAttribute("hx-get")).toMatch(/poll=1(?:&|$)/);
		expect(row.getAttribute("hx-trigger")).toBe("every 3s");
		const button = saveButton(row);
		expect(button.getAttribute("data-test-save-state")).toBe("saving");
		expect(button.textContent?.trim()).toBe("Saving…");
		expect(harness.submittedLinks).toEqual([{ userId, url: "https://example.com/post" }]);
		expect(errors).toHaveLength(1);
		assert(errors[0].startsWith("[inbox-link-feedback] "));
	});

	it("posts the row form to itself rather than boosting the whole page", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, skipped);

		const response = await agent.post(savePath).set("HX-Request", "true");

		const form = saveButton(excludedRow(response.text)).closest("form");
		assert(form, "the save button must stay inside its form");
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("action")).toBe(savePath);
		expect(form.getAttribute("hx-post")).toBe(savePath);
		expect(form.getAttribute("hx-target")).toBe("#inbox-skipped-0000");
		expect(form.getAttribute("hx-swap")).toBe("outerHTML");
		expect(form.getAttribute("hx-disabled-elt")).toBe("find button");
	});

	it("keeps the boosted whole-page redirect for a page still running the old markup", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, skipped);

		const response = await agent
			.post(savePath)
			.set("HX-Request", "true")
			.set("HX-Boosted", "true");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			`/inbox/${encodeURIComponent(SK)}?tab=excluded&saved=1`,
		);
	});

	it("leaves the Articles tab's save on its redirect, which this row swap does not cover", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture);

		const response = await agent.post(savePath).set("HX-Request", "true");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(
			`/inbox/${encodeURIComponent(SK)}?tab=articles&saved=1`,
		);
	});

	it("reads the save state after publishing, so a settle that already landed skips Saving… entirely", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		settlingFixture = fixture;
		const harness = useSettlingApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, skipped);

		const response = await agent.post(savePath).set("HX-Request", "true");

		expect(response.status).toBe(200);
		const row = excludedRow(response.text);
		expect(row.hasAttribute("hx-get")).toBe(false);
		expect(saveButton(row).getAttribute("data-test-save-state")).toBe("saved");
		const live = new JSDOM(response.text).window.document.querySelector(
			"[data-test-inbox-live-status]",
		);
		assert(live, "a save that settled inside the request must announce itself");
		expect(live.textContent).toBe("Saved to your queue: https://example.com/post");
	});

	it("retracts a recorded failure before retrying, so the retry reads as in flight rather than dead", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture, skipped);
		await fixture.inboxEmail.inboxSavedLinkStore.markLinkSaveFailed({
			userId,
			url: "https://example.com/post",
		});

		const response = await agent.post(savePath).set("HX-Request", "true");

		const row = excludedRow(response.text);
		expect(row.getAttribute("hx-get")).toMatch(/poll=1(?:&|$)/);
		expect(saveButton(row).getAttribute("data-test-save-state")).toBe("saving");
		expect(
			await fixture.inboxEmail.inboxSavedLinkStore.findSavedLinks({
				userId,
				urls: ["https://example.com/post"],
			}),
		).toEqual(new Map());
	});

	it("retracts a recorded failure on the plain form post too", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture, skipped);
		await fixture.inboxEmail.inboxSavedLinkStore.markLinkSaveFailed({
			userId,
			url: "https://example.com/post",
		});

		const response = await agent.post(savePath);

		expect(response.status).toBe(303);
		expect(
			await fixture.inboxEmail.inboxSavedLinkStore.findSavedLinks({
				userId,
				urls: ["https://example.com/post"],
			}),
		).toEqual(new Map());
	});

	it("leaves an accepted save standing when the reader saves again", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture, skipped);
		await fixture.inboxEmail.inboxSavedLinkStore.markLinkSaved({
			userId,
			url: "https://example.com/post",
		});

		const response = await agent.post(savePath).set("HX-Request", "true");

		const row = excludedRow(response.text);
		expect(row.hasAttribute("hx-get")).toBe(false);
		expect(saveButton(row).getAttribute("data-test-save-state")).toBe("saved");
	});
});

describe("Inbox link save route under the save gates", () => {
	function hxHeaderNames(headers: Record<string, unknown>): string[] {
		return Object.keys(headers)
			.filter((name) => name.startsWith("hx-"))
			.sort();
	}

	it("hands a locked reader's in-place save the headers that put the locked page back in <main>", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.shared.now = () => new Date(Date.now() + 8 * 86_400_000);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, { status: "skipped", skipReason: "llm-ad", title: undefined });

		const response = await agent.post(savePath).set("HX-Request", "true");

		expect(response.status).toBe(403);
		expect(new JSDOM(response.text).window.document.querySelector("h1")?.textContent).toBe(
			"Your account is locked",
		);
		expect(hxHeaderNames(response.headers)).toEqual(["hx-reselect", "hx-reswap", "hx-retarget"]);
		expect(response.headers["hx-retarget"]).toBe("main");
		expect(response.headers["hx-reselect"]).toBe("main");
		expect(response.headers["hx-reswap"]).toBe("outerHTML show:none");
		expect(harness.submittedLinks).toEqual([]);
	});

	it("leaves a boosted locked save exactly as it was, since boost already targets <main>", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.shared.now = () => new Date(Date.now() + 8 * 86_400_000);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		await seed(fixture, { status: "skipped", skipReason: "llm-ad", title: undefined });

		const response = await agent
			.post(savePath)
			.set("HX-Request", "true")
			.set("HX-Boosted", "true");

		expect(response.status).toBe(403);
		expect(hxHeaderNames(response.headers)).toEqual([]);
	});
});

describe("Inbox link save route with a relayed publisher", () => {
	// The e2e harness stands in for the deployed round trip — publish, accept,
	// LinkQueued, read model — so the Saved chip can appear against an in-memory
	// stack. This pins that seam from the same route a reader would use.
	const relayed: Array<{ userId: string; url: string }> = [];
	const useRelayingApp = useTestServer({
		publishSubmitLink: async (input) => {
			relayed.push(input);
		},
	});

	it("shows a saved skipped link as saved on the tab the save redirects back to", async () => {
		relayed.length = 0;
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useRelayingApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture, { status: "skipped", skipReason: "llm-ad" });
		// The barrier extraction always writes on completion, so the seeded row
		// renders as the terminal Skipped list rather than a still-extracting panel.
		await fixture.inboxEmail.inboxEmailLinkStore.putLinksMeta({
			userId,
			receivedAtMessageId: SK,
			meta: { truncated: false, extractionFailed: false },
		});

		const beforeSave = new JSDOM(
			(await agent.get(`/inbox/${encodeURIComponent(SK)}?tab=excluded`)).text,
		).window.document.querySelector("[data-test-inbox-excluded-save]");
		assert(beforeSave, "the skipped row must offer its save button before the save");
		expect(beforeSave.getAttribute("data-test-save-state")).toBe("unsaved");

		const response = await agent.post(savePath);
		// The deployed pipeline records the fact from the accepted save; the relay
		// stands in for it so the follow-up render reads the state a reader would see.
		await fixture.inboxEmail.inboxSavedLinkStore.markLinkSaved({
			userId,
			url: "https://example.com/post",
		});
		const doc = new JSDOM((await agent.get(response.headers.location)).text).window.document;

		expect(response.headers.location).toContain("tab=excluded");
		const afterSave = doc.querySelector("[data-test-inbox-excluded-save]");
		assert(afterSave, "the saved skipped row stays on the Skipped tab with its button");
		expect(afterSave.getAttribute("data-test-save-state")).toBe("saved");
		expect(afterSave.textContent?.trim()).toBe("Save again");
	});

	it("relays the submitted link to the injected publisher as well as recording it", async () => {
		relayed.length = 0;
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useRelayingApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await seed(fixture);

		const response = await agent.post(savePath);

		expect(response.status).toBe(303);
		expect(relayed).toEqual([{ userId, url: "https://example.com/post" }]);
		expect(harness.submittedLinks).toEqual([{ userId, url: "https://example.com/post" }]);
	});
});
