import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import {
	createDefaultTestAppFixture,
	createFakeSummaryProvider,
	TEST_APP_ORIGIN,
} from "@packages/test-fixtures";
import { useTestServer } from "../../../test-app";
import { buildOwnerReaderPath } from "./owner-reader-link";
import type { RecordEngagementActivity } from "@packages/provider-contracts/engagement-starter";
import type { EmailMessage } from "@packages/provider-contracts/email";
import { initSendStarter } from "../../../domain/engagement/send-starter";
import { initQueueDigestUnsubscribeToken } from "../../../domain/email/queue-digest-unsubscribe-token";
import { QUEUE_DIGEST_UNSUBSCRIBE_PATH } from "../../queue-digest-email";

const useApp = useTestServer();
const NOW = new Date("2026-10-10T12:00:00.000Z");
const READLIST = ReadlistSlugSchema.parse("hn-picks");

describe("starter readlist", () => {
	it("records deliberate reader, summary and read actions without counting polling or prefetches", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.shared.now = () => NOW;
		const created = await fixture.auth.createUser({
			email: "reader@recipient.com",
			password: "password123",
		});
		assert(created.ok);
		const userId = created.userId;
		await fixture.auth.markEmailVerified("reader@recipient.com");
		const url = "https://publisher.com/tracked";
		const articleId = ReaderArticleHashId.from(url);
		const suggestionAttribution = {
			campaignId: "hn-starter-v1",
			hnItemId: 100,
			rank: 1,
			snapshotAt: NOW.toISOString(),
		};
		await fixture.articleStore.saveArticle({
			userId,
			url,
			metadata: { title: "Tracked", siteName: "Site", excerpt: "", wordCount: 200 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "hn-suggestion", ...suggestionAttribution },
			suggestionAttribution,
			savedAt: NOW,
		});
		const activity: Parameters<RecordEngagementActivity>[0][] = [];
		fixture.engagementStarter.recordEngagementActivity = async (input) => {
			activity.push(input);
		};
		const app = useApp(fixture);
		const agent = request.agent(app.server);
		await agent
			.post("/login")
			.type("form")
			.send({ email: "reader@recipient.com", password: "password123" });
		const path = `/queue/${articleId.value}/view`;
		for (const accept of ["text/html", "text/markdown"]) {
			await agent.get(`${path}?poll=1`).set("Accept", accept);
			for (const header of ["X-Purpose", "Purpose", "Sec-Purpose"])
				await agent
					.get(path)
					.set("Accept", accept)
					.set(header, header === "X-Purpose" ? "preview" : "prefetch;prerender");
		}
		expect(activity).toEqual([]);
		await agent.get(path).set("Accept", "text/html");
		await agent.get(path).set("Accept", "text/markdown");
		await agent.post(`/queue/${articleId.value}/summary-toggle?state=closed`);
		await agent.post(`/queue/${articleId.value}/summary-toggle?state=open`);
		await agent.post(`/queue/${articleId.value}/status`).type("form").send({ status: "read" });
		expect(activity.map((input) => input.kind)).toEqual([
			"reader-open",
			"reader-open",
			"summary-open",
			"read-status",
		]);
		expect(
			activity.every(
				(input) =>
					input.userId === userId &&
					input.articleId?.value === articleId.value &&
					input.campaignId === suggestionAttribution.campaignId,
			),
		).toBe(true);
		expect(activity.at(-1)?.markedRead).toBe(true);
	});
	it("counts a reader's own save, filing and authenticated import upload as activity", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.shared.now = () => NOW;
		const created = await fixture.auth.createUser({
			email: "reader@recipient.com",
			password: "password123",
		});
		assert(created.ok);
		const userId = created.userId;
		await fixture.auth.markEmailVerified("reader@recipient.com");
		await fixture.subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub",
			customerId: "customer",
		});
		const activity: Parameters<RecordEngagementActivity>[0][] = [];
		fixture.engagementStarter.recordEngagementActivity = async (input) => {
			activity.push(input);
		};
		const app = useApp(fixture);
		const agent = request.agent(app.server);
		await agent
			.post("/login")
			.type("form")
			.send({ email: "reader@recipient.com", password: "password123" });
		const url = "https://publisher.com/filed";
		const recorded = () => activity.map(({ kind, userId: id }) => ({ kind, id }));

		await agent.post("/queue/save").type("form").send({ url });
		expect(recorded()).toEqual([{ kind: "personal-save", id: userId }]);

		const readlist = await agent.post("/queue/queues").type("form").send({ label: "New Readlist" });
		const slug = new URL(readlist.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
		assert(slug);
		await agent
			.post(`/queue/${ReaderArticleHashId.from(url).value}/assign`)
			.type("form")
			.send({ queue: slug });
		expect(recorded()).toEqual([
			{ kind: "personal-save", id: userId },
			{ kind: "personal-save", id: userId },
		]);

		const boundary = "----StarterActivityBoundary";
		await agent
			.post("/import")
			.set("Content-Type", `multipart/form-data; boundary=${boundary}`)
			.send(
				Buffer.from(
					`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="urls.txt"\r\nContent-Type: application/octet-stream\r\n\r\nhttps://publisher.com/imported\r\n--${boundary}--\r\n`,
				),
			);
		expect(recorded()).toEqual([
			{ kind: "personal-save", id: userId },
			{ kind: "personal-save", id: userId },
			{ kind: "import-request", id: userId },
		]);
	});
	it("keeps a save, its crawl and the reader working when engagement activity cannot be recorded", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const failure = new Error("onboarding write failed");
		fixture.engagementStarter.recordEngagementActivity = async () => {
			throw failure;
		};
		const logged: { message: string; error: Error | undefined }[] = [];
		fixture.shared.logError = (message, error) => {
			logged.push({ message, error });
		};
		const created = await fixture.auth.createUser({
			email: "reader@recipient.com",
			password: "password123",
		});
		assert(created.ok);
		await fixture.auth.markEmailVerified("reader@recipient.com");
		const app = useApp(fixture);
		const agent = request.agent(app.server);
		await agent
			.post("/login")
			.type("form")
			.send({ email: "reader@recipient.com", password: "password123" });
		const url = "https://publisher.com/saved-anyway";

		const save = await agent.post("/queue/save").type("form").send({ url });
		const view = await agent
			.get(`/queue/${ReaderArticleHashId.from(url).value}/view`)
			.set("Accept", "text/html");

		expect(save.status).toBe(303);
		expect(await fixture.articleCrawl.findArticleCrawlStatus(url)).toEqual({ status: "ready" });
		expect(view.status).toBe(200);
		expect(logged.filter((line) => line.message === "Failed to record engagement activity")).toEqual([
			{ message: "Failed to record engagement activity", error: failure },
			{ message: "Failed to record engagement activity", error: failure },
		]);
	});
	it("explains the picks only on their readlist and labels only the suggested articles", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.shared.now = () => NOW;
		const created = await fixture.auth.createUser({
			email: "reader@recipient.com",
			password: "password123",
		});
		assert(created.ok);
		const userId = created.userId;
		await fixture.auth.markEmailVerified("reader@recipient.com");
		await fixture.subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub",
			customerId: "customer",
		});
		const picks = Array.from({ length: 10 }, (_, i) => ({
			url: `https://publisher.com/pick-${i}`,
			rank: i + 1,
			hnItemId: i + 100,
			snapshotAt: NOW.toISOString(),
		}));
		for (const pick of picks) {
			await fixture.articleStore.saveArticleGlobally({
				url: pick.url,
				metadata: { title: `Pick ${pick.rank}`, siteName: "Publisher", excerpt: "", wordCount: 200 },
				estimatedReadTime: MinutesSchema.parse(1),
				savedAt: NOW,
			});
			await fixture.articleStore.setReaderAvailableAt({ url: pick.url, at: NOW });
		}
		await fixture.articleStore.saveStarterPack({
			userId,
			activityRevision: 0,
			at: NOW,
			savedAt: Array(10).fill(NOW),
			pack: {
				campaignId: "hn-starter-v1",
				picks,
				readlist: READLIST,
				readlistLabel: "Hacker News picks",
				selectedAt: NOW.toISOString(),
				emailStatus: "pending",
			},
		});
		const personal = "https://publisher.com/personal";
		await fixture.articleStore.saveArticle({
			userId,
			url: personal,
			metadata: { title: "Personal", siteName: "Publisher", excerpt: "", wordCount: 200 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: NOW,
		});
		assert(
			(
				await fixture.articleStore.assignSavedArticleToReadlist({
					userId,
					readlist: READLIST,
					from: DEFAULT_READLIST_SLUG,
					url: personal,
					savedAt: NOW,
				})
			).assigned,
		);
		const app = useApp(fixture);
		const agent = request.agent(app.server);
		await agent
			.post("/login")
			.type("form")
			.send({ email: "reader@recipient.com", password: "password123" });
		const labelHidden = Object.fromEntries([
			[ReaderArticleHashId.from(personal).value, true],
			...picks.map((pick) => [ReaderArticleHashId.from(pick.url).value, false]),
		]);

		for (const [path, explained] of [
			["/queue", false],
			["/queue?queue=hn-picks", true],
		] as const) {
			const document = new JSDOM((await agent.get(path)).text).window.document;
			const explanation = document.querySelector('[data-test-alert="starter-picks"]');
			assert(explanation);
			expect(explanation.classList.contains("alert--visible")).toBe(explained);
			expect(
				Object.fromEntries(
					Array.from(document.querySelectorAll("[data-test-article]"), (card) => {
						const label = card.querySelector("[data-test-suggestion-label]");
						assert(label);
						return [
							card.getAttribute("data-test-article"),
							label.classList.contains("readlist-article__suggestion--hidden"),
						];
					}),
				),
			).toEqual(labelHidden);
		}
	});
	it("renders explanation and attribution with plain forms and saves personal articles to All", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.shared.now = () => NOW;
		const created = await fixture.auth.createUser({
			email: "reader@recipient.com",
			password: "password123",
		});
		assert(created.ok);
		const userId = created.userId;
		await fixture.auth.markEmailVerified("reader@recipient.com");
		await fixture.subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub",
			customerId: "customer",
		});
		const picks = Array.from({ length: 10 }, (_, i) => ({
			url: `https://publisher.com/pick-${i}`,
			rank: i + 1,
			hnItemId: i + 100,
			snapshotAt: NOW.toISOString(),
		}));
		for (const pick of picks) {
			await fixture.articleStore.saveArticleGlobally({
				url: pick.url,
				metadata: {
					title: `Pick ${pick.rank}`,
					siteName: "Publisher",
					excerpt: "Article",
					wordCount: 200,
				},
				estimatedReadTime: MinutesSchema.parse(1),
				savedAt: NOW,
			});
			await fixture.articleStore.setReaderAvailableAt({ url: pick.url, at: NOW });
		}
		await fixture.articleStore.saveStarterPack({
			userId,
			activityRevision: 0,
			at: NOW,
			savedAt: Array(10).fill(NOW),
			pack: {
				campaignId: "hn-starter-v1",
				picks,
				readlist: READLIST,
				readlistLabel: "Hacker News picks",
				selectedAt: NOW.toISOString(),
				emailStatus: "pending",
			},
		});
		const app = useApp(fixture);
		const agent = request.agent(app.server);
		await agent
			.post("/login")
			.type("form")
			.send({ email: "reader@recipient.com", password: "password123" });
		const response = await agent.get("/queue?queue=hn-picks");
		expect(response.status).toBe(200);
		const document = new JSDOM(response.text).window.document;
		expect(
			document.querySelectorAll(
				"[data-test-suggestion-label]:not(.readlist-article__suggestion--hidden)",
			),
		).toHaveLength(10);
		expect(document.body.textContent).toContain("Added by Readplace from Hacker News");
		expect(document.body.textContent).toContain("Readplace added");
		const form = document.querySelector('form[data-test-form="save-article"]');
		assert(form);
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.querySelector('input[name="queue"]')).toBeNull();
		const action = form.getAttribute("action");
		assert(action);
		await agent.post(action).type("form").send({ url: "https://publisher.com/personal" });
		expect(
			(
				await fixture.articleStore.findArticleById(
					ReaderArticleHashId.from("https://publisher.com/personal"),
					userId,
				)
			)?.provenance?.kind,
		).toBe("web");
		expect(
			await fixture.articleStore.findReadlistArticleById({
				userId,
				readlist: READLIST,
				id: ReaderArticleHashId.from("https://publisher.com/personal"),
			}),
		).toBeNull();
		expect(new URL(action, TEST_APP_ORIGIN).searchParams.get("queue")).not.toBe(READLIST);
		expect((await fixture.articleStore.findPersonalLibrary(userId)).personalCount).toBe(1);
	});
	it("preserves the selected readlist and campaign through the owner login redirect", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const created = await fixture.auth.createUser({
			email: "reader@recipient.com",
			password: "password123",
		});
		assert(created.ok);
		const userId = created.userId;
		await fixture.auth.markEmailVerified("reader@recipient.com");
		const url = "https://publisher.com/pick";
		await fixture.articleStore.saveArticle({
			userId,
			url,
			metadata: { title: "Pick", siteName: "Site", excerpt: "", wordCount: 200 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: NOW,
		});
		const app = useApp(fixture);
		const path = buildOwnerReaderPath(ReaderArticleHashId.from(url), {
			readlist: READLIST,
			campaignId: "hn-starter-v1",
		});
		const response = await request(app.server).get(path);
		expect(response.status).toBe(303);
		const login = new URL(response.headers.location, TEST_APP_ORIGIN);
		expect(login.pathname).toBe("/login");
		const destination = new URL(String(login.searchParams.get("return")), TEST_APP_ORIGIN);
		expect(destination.searchParams.get("queue")).toBe(READLIST);
		expect(destination.searchParams.get("campaign")).toBe("hn-starter-v1");
	});
	it.each([
		{ removal: "the pick from the starter readlist", path: (id: string) => `/queue/${id}/delete?queue=${READLIST}` },
		{ removal: "the starter readlist", path: () => `/queue/queues/${READLIST}/delete` },
	])("opens the owner reader from a starter link after the reader deletes $removal", async ({ path }) => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const created = await fixture.auth.createUser({
			email: "reader@recipient.com",
			password: "password123",
		});
		assert(created.ok);
		const userId = created.userId;
		await fixture.auth.markEmailVerified("reader@recipient.com");
		const picks = Array.from({ length: 10 }, (_, i) => ({
			url: `https://publisher.com/pick-${i}`,
			rank: i + 1,
			hnItemId: i + 100,
			snapshotAt: NOW.toISOString(),
		}));
		for (const pick of picks) {
			await fixture.articleStore.saveArticleGlobally({
				url: pick.url,
				metadata: { title: `Pick ${pick.rank}`, siteName: "Publisher", excerpt: "", wordCount: 200 },
				estimatedReadTime: MinutesSchema.parse(1),
				savedAt: NOW,
			});
		}
		await fixture.articleStore.saveStarterPack({
			userId,
			activityRevision: 0,
			at: NOW,
			savedAt: Array(10).fill(NOW),
			pack: {
				campaignId: "hn-starter-v1",
				picks,
				readlist: READLIST,
				readlistLabel: "Hacker News picks",
				selectedAt: NOW.toISOString(),
				emailStatus: "pending",
			},
		});
		const pickId = ReaderArticleHashId.from("https://publisher.com/pick-1");
		const app = useApp(fixture);
		const agent = request.agent(app.server);
		await agent
			.post("/login")
			.type("form")
			.send({ email: "reader@recipient.com", password: "password123" });
		await agent.post(path(pickId.value)).type("form").send({});

		const response = await agent
			.get(buildOwnerReaderPath(pickId, { readlist: READLIST, campaignId: "hn-starter-v1" }))
			.redirects(3);

		expect(
			await fixture.articleStore.findReadlistArticleById({ userId, readlist: READLIST, id: pickId }),
		).toBeNull();
		expect(response.status).toBe(200);
		expect(
			response.redirects.filter((location) => new URL(location).pathname.startsWith("/view/")),
		).toEqual([]);
		expect(
			new JSDOM(response.text).window.document.querySelector("[data-test-mark-read-form]"),
		).not.toBeNull();
	});
	it("serves every link of the starter email, tracking term included", async () => {
		const summary = createFakeSummaryProvider();
		const fixture = { ...createDefaultTestAppFixture(TEST_APP_ORIGIN), summary };
		fixture.shared.now = () => NOW;
		const created = await fixture.auth.createUser({
			email: "reader@recipient.com",
			password: "password123",
		});
		assert(created.ok);
		const userId = created.userId;
		await fixture.auth.markEmailVerified("reader@recipient.com");
		await fixture.subscriptionProviders.upsertActive({
			userId,
			subscriptionId: "sub",
			customerId: "customer",
		});
		const picks = Array.from({ length: 10 }, (_, i) => ({
			url: `https://publisher.com/pick-${i}`,
			rank: i + 1,
			hnItemId: i + 100,
			snapshotAt: NOW.toISOString(),
		}));
		for (const pick of picks) {
			await fixture.articleStore.saveArticleGlobally({
				url: pick.url,
				metadata: { title: `Pick ${pick.rank}`, siteName: "Publisher", excerpt: "", wordCount: 200 },
				estimatedReadTime: MinutesSchema.parse(1),
				savedAt: NOW,
			});
			await fixture.articleStore.setReaderAvailableAt({ url: pick.url, at: NOW });
			summary.markSummaryReady({ url: pick.url, summary: "A useful summary.", excerpt: "", topics: [] });
		}
		const pack = {
			campaignId: "hn-starter-v1",
			picks,
			readlist: READLIST,
			readlistLabel: "Hacker News picks",
			selectedAt: NOW.toISOString(),
			emailStatus: "pending" as const,
		};
		await fixture.engagementStarter.assignStarter({
			userId,
			revision: 0,
			assignment: {
				campaignId: "hn-starter-v1",
				arm: "treatment",
				assignedAt: NOW.toISOString(),
				tier: "paid",
				accountCohort: "new",
			},
			pack,
		});
		await fixture.engagementStarter.saveStarterPack({
			userId,
			activityRevision: 1,
			at: NOW,
			savedAt: Array(10).fill(NOW),
			pack,
		});
		const sent: EmailMessage[] = [];
		await initSendStarter({
			state: fixture.engagementStarter,
			findUserContactByUserId: fixture.auth.findUserContactByUserId,
			findSubscriptionByUserId: fixture.subscriptionProviders.findByUserId,
			findReaderReadyEmailState: async () => ({ lastSentAt: undefined, lastMessageId: undefined }),
			findReadlistArticleById: fixture.articleStore.findReadlistArticleById,
			findArticleById: fixture.articleStore.findArticleById,
			listUserSavesForUrl: fixture.articleStore.listUserSavesForUrl,
			findArticleByUrl: fixture.articleStore.findArticleByUrl,
			findGeneratedSummary: summary.findGeneratedSummary,
			sendEmail: async (message) => {
				sent.push(message);
			},
			signUnsubscribeToken: initQueueDigestUnsubscribeToken("test-analytics-salt").sign,
			appOrigin: TEST_APP_ORIGIN,
			now: () => NOW,
			emit: () => {},
		})(userId);
		const message = sent[0];
		assert(message);
		const links = [...new JSDOM(message.html).window.document.querySelectorAll("a[href]")].map(
			(link) => new URL(String(link.getAttribute("href"))),
		);
		const app = useApp(fixture);
		const served: { path: string; status: number; location?: string }[] = [];
		for (const link of links) {
			const response = await request(app.server).get(`${link.pathname}${link.search}`);
			served.push({
				path: link.pathname,
				status: response.status,
				...(response.status === 303
					? { location: new URL(response.headers.location, TEST_APP_ORIGIN).pathname }
					: {}),
			});
		}
		expect(served).toEqual(
			links.map((link) =>
				link.pathname === QUEUE_DIGEST_UNSUBSCRIBE_PATH
					? { path: link.pathname, status: 200 }
					: { path: link.pathname, status: 303, location: "/login" },
			),
		);
	});
});
