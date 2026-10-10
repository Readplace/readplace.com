import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { noopLogger } from "@packages/hutch-logger";
import { initInMemoryArticleStore, noArticleTopics } from "@packages/test-fixtures/providers/article-store";
import { initInMemoryEngagementStarter } from "@packages/test-fixtures/providers/onboarding-signals";
import { initInMemoryGeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import type { UserContact } from "@packages/provider-contracts/auth";
import type { EmailMessage } from "@packages/provider-contracts/email";
import type { StarterPick } from "@packages/provider-contracts/engagement-starter";
import { resolveEffectiveAccess } from "@packages/subscription-access";
import { initEnrollStarter } from "./enroll-starter";
import { initSendStarter } from "./send-starter";
import {
	STARTER_EMAIL_GAP_MS,
	STARTER_INACTIVITY_MS,
	STARTER_RETRY_WINDOW_MS,
	hasStarterObservation,
	starterArm,
	type StarterRollout,
} from "./starter-policy";

const NOW = new Date("2026-10-10T12:00:00.000Z");
const userId = UserIdSchema.parse("reader");
const rollout: StarterRollout = {
	campaignId: "hn-starter-v1",
	observationStartedAt: "2026-10-05T12:00:00.000Z",
	enrollmentStartedAt: "2026-10-08T12:00:00.000Z",
	deploymentSha: "deployment",
	excludedUserIds: [],
	treatmentPercent: 80,
	personalArticleLimit: 5,
	inactivityHours: 72,
	firstReviewDay: 42,
	reviewEnrollmentDays: 28,
};

async function subject(
	input: {
		id?: string;
		enroll?: Partial<Parameters<typeof initEnrollStarter>[0]>;
		send?: Partial<Parameters<typeof initSendStarter>[0]>;
	} = {},
) {
	const id = UserIdSchema.parse(input.id ?? userId);
	const clock = { now: NOW };
	const library = initInMemoryArticleStore({ findTopics: noArticleTopics });
	const state = initInMemoryEngagementStarter({ library });
	const summaries = initInMemoryGeneratedSummary();
	const subscriptions = initInMemorySubscriptionProviders({ now: () => clock.now });
	await subscriptions.upsertActive({ userId: id, subscriptionId: "sub", customerId: "customer" });
	const picks: StarterPick[] = Array.from({ length: 10 }, (_, i) => ({
		url: `https://example.com/hn-${i}`,
		hnItemId: i + 100,
		rank: i + 1,
		snapshotAt: NOW.toISOString(),
	}));
	for (const pick of picks) {
		await library.saveArticleGlobally({
			url: pick.url,
			metadata: {
				title: `HN ${pick.rank}`,
				siteName: "Example",
				excerpt: "Article",
				wordCount: 300,
			},
			estimatedReadTime: MinutesSchema.parse(2),
			savedAt: NOW,
		});
		await library.setReaderAvailableAt({ url: pick.url, at: NOW });
		await library.writeContent({ url: pick.url, content: "<p>An article</p>" });
		await summaries.markSummaryReady({
			url: pick.url,
			summary: "A useful summary of this article.",
			topics: [],
		});
	}
	const contact: UserContact = {
		email: "reader@recipient.com",
		emailVerified: true,
		queueDigestOptOutAt: undefined,
	};
	const events: Array<{ event: string; reason?: string; itemCount?: number }> = [];
	const sent: EmailMessage[] = [];
	const enrollDeps: Parameters<typeof initEnrollStarter>[0] = {
		state,
		findUserById: async () => ({
			userId: id,
			email: contact.email,
			emailVerified: true,
			registeredAt: "2026-10-01T00:00:00.000Z",
		}),
		findUserContactByUserId: async () => contact,
		getEffectiveAccess: async () =>
			resolveEffectiveAccess(await subscriptions.findByUserId(id), clock.now),
		resolveSaveAccess: async () => ({ allowed: true }),
		findPersonalLibrary: library.findPersonalLibrary,
		listReadlistDefinitions: library.listReadlistDefinitions,
		findReadySnapshot: async () => picks,
		saveStarterPack: state.saveStarterPack,
		allocateSavedAtSequence: library.allocateSavedAtSequence,
		newReadlistSlug: () => ReadlistSlugSchema.parse("hn-picks"),
		findRollout: async () => rollout,
		excludedUserIds: [],
		now: () => clock.now,
		logger: noopLogger,
		emit: (input) => events.push(input),
		...input.enroll,
	};
	const sendDeps: Parameters<typeof initSendStarter>[0] = {
		state,
		findUserContactByUserId: async () => contact,
		findSubscriptionByUserId: subscriptions.findByUserId,
		findReaderReadyEmailState: async () => ({ lastSentAt: undefined, lastMessageId: undefined }),
		findReadlistArticleById: library.findReadlistArticleById,
		findArticleById: library.findArticleById,
		listUserSavesForUrl: library.listUserSavesForUrl,
		findArticleByUrl: library.findArticleByUrl,
		findGeneratedSummary: summaries.findGeneratedSummary,
		sendEmail: async (message) => {
			sent.push(message);
		},
		signUnsubscribeToken: () => "unsubscribe-token",
		appOrigin: "https://readplace.com",
		now: () => clock.now,
		emit: (input) => events.push(input),
		...input.send,
	};
	return {
		id,
		clock,
		state,
		library,
		subscriptions,
		summaries,
		picks,
		sent,
		events,
		contact,
		enrollDeps,
		sendDeps,
		enroll: initEnrollStarter(enrollDeps),
		send: initSendStarter(sendDeps),
	};
}

describe("starter eligibility and insertion", () => {
	it("adds ten identities to twenty memberships, once, without user-save recommendation events", async () => {
		const app = await subject();
		await app.enroll(app.id);
		expect((await app.library.findArticlesByUser({ userId: app.id })).articles).toHaveLength(10);
		expect(
			(
				await app.library.findReadlistArticles({
					userId: app.id,
					readlist: ReadlistSlugSchema.parse("hn-picks"),
				})
			).articles,
		).toHaveLength(10);
		expect(
			(await app.library.findArticlesAcrossReadlists({ userId: app.id })).articles,
		).toHaveLength(10);
		expect((await app.library.findPersonalLibrary(app.id)).personalCount).toBe(0);
		expect(app.events.map((event) => event.event)).toEqual(["assigned", "inserted"]);
		for (const article of (await app.library.findArticlesByUser({ userId: app.id })).articles) {
			await app.library.deleteArticle(article.id, app.id);
			await app.library.deleteReadlistArticle({
				userId: app.id,
				id: article.id,
				readlist: ReadlistSlugSchema.parse("hn-picks"),
			});
		}
		await app.library.deleteReadlistDefinition({
			userId: app.id,
			slug: ReadlistSlugSchema.parse("hn-picks"),
		});
		await app.enroll(app.id);
		expect((await app.library.findArticlesByUser({ userId: app.id })).articles).toEqual([]);
		expect(
			(
				await app.library.findReadlistArticles({
					userId: app.id,
					readlist: ReadlistSlugSchema.parse("hn-picks"),
				})
			).articles,
		).toEqual([]);
		expect(await app.library.listReadlistDefinitions(app.id)).toEqual([]);
		expect(app.events.map((event) => event.event)).toEqual(["assigned", "inserted"]);
		expect((await app.state.findStarterPack(app.id))?.insertedAt).toBe(NOW.toISOString());
	});
	it("assigns comparison at the same readiness boundary and permanently retains the assignment", async () => {
		const app = await subject({ id: "user-1" });
		await app.enroll(app.id);
		await app.enroll(app.id);
		expect((await app.state.findEngagement(app.id)).assignment).toMatchObject({
			arm: "comparison",
			assignedAt: NOW.toISOString(),
		});
		expect((await app.library.findPersonalLibrary(app.id)).urls).toEqual([]);
		expect(await app.state.findStarterPack(app.id)).toBeUndefined();
		expect(await app.send(app.id)).toBe(false);
	});
	it("keeps a trial eligible independently of Gmail's paid connection gate", async () => {
		const app = await subject();
		await app.subscriptions.upsertTrialing({
			userId: app.id,
			trialEndsAt: "2026-10-24T12:00:00.000Z",
		});
		await app.enroll(app.id);
		expect((await app.state.findEngagement(app.id)).assignment?.tier).toBe("trial");
		expect((await app.state.findStarterPack(app.id))?.insertedAt).toBe(NOW.toISOString());
	});
	it("enrolls a new account at its seventy-two-hour boundary and records the new-account cohort", async () => {
		const registeredAt = new Date(NOW.getTime() - STARTER_INACTIVITY_MS).toISOString();
		const app = await subject({
			enroll: {
				findUserById: async () => ({
					userId,
					email: "reader@recipient.com",
					emailVerified: true,
					registeredAt,
				}),
			},
		});
		app.clock.now = new Date(NOW.getTime() - 1);
		await app.enroll(app.id);
		expect((await app.state.findEngagement(app.id)).assignment).toBeUndefined();
		app.clock.now = NOW;
		await app.enroll(app.id);
		expect((await app.state.findEngagement(app.id)).assignment).toMatchObject({
			accountCohort: "new",
			assignedAt: NOW.toISOString(),
		});
	});
	it.each([
		["no recorded rollout", { findRollout: async () => undefined }],
		["internal account", { excludedUserIds: [userId] }],
		["missing user", { findUserById: async () => null }],
		[
			"unknown account age",
			{ findUserById: async () => ({ userId, email: "x", emailVerified: true }) },
		],
		["no contact", { findUserContactByUserId: async () => null }],
		[
			"unverified",
			{
				findUserContactByUserId: async () => ({
					email: "x",
					emailVerified: false,
					queueDigestOptOutAt: undefined,
				}),
			},
		],
		[
			"opted out",
			{
				findUserContactByUserId: async () => ({
					email: "x",
					emailVerified: true,
					queueDigestOptOutAt: NOW.toISOString(),
				}),
			},
		],
		[
			"test email",
			{
				findUserContactByUserId: async () => ({
					email: "reader@example.com",
					emailVerified: true,
					queueDigestOptOutAt: undefined,
				}),
			},
		],
		[
			"pending deletion",
			{
				findUserById: async () => ({
					userId,
					email: "reader@recipient.com",
					emailVerified: true,
					registeredAt: "2026-10-01T00:00:00.000Z",
					deletedAt: NOW.toISOString(),
				}),
			},
		],
		["save lock", { resolveSaveAccess: async () => ({ allowed: false }) }],
		["too little content", { findReadySnapshot: async () => [] }],
		[
			"five personal articles",
			{ findPersonalLibrary: async () => ({ personalCount: 5, urls: [] }) },
		],
		[
			"unavailable custom slot",
			{
				listReadlistDefinitions: async () =>
					Array.from({ length: 7 }, (_, i) => ({
						slug: ReadlistSlugSchema.parse(`list-${i}`),
						label: `List ${i}`,
						createdAt: NOW,
					})),
			},
		],
	] satisfies Array<
		[string, Partial<Parameters<typeof initEnrollStarter>[0]>]
	>)("defers before assignment for %s", async (_name, enroll) => {
		const app = await subject({ enroll });
		await app.enroll(app.id);
		expect((await app.state.findEngagement(app.id)).assignment).toBeUndefined();
	});
	it.each([
		["four personal articles", { findPersonalLibrary: async () => ({ personalCount: 4, urls: [] }) }],
		[
			"six custom readlists",
			{
				listReadlistDefinitions: async () =>
					Array.from({ length: 6 }, (_, i) => ({
						slug: ReadlistSlugSchema.parse(`list-${i}`),
						label: `List ${i}`,
						createdAt: NOW,
					})),
			},
		],
	] satisfies Array<
		[string, Partial<Parameters<typeof initEnrollStarter>[0]>]
	>)("still enrols and inserts the pack with %s", async (_name, enroll) => {
		const app = await subject({ enroll });
		await app.enroll(app.id);
		expect((await app.state.findEngagement(app.id)).assignment?.arm).toBe("treatment");
		expect((await app.state.findStarterPack(app.id))?.insertedAt).toBe(NOW.toISOString());
	});
	it("defers founding and inactive accounts", async () => {
		const founding = await subject();
		await founding.subscriptions.deleteSubscription({ userId: founding.id });
		await founding.enroll(founding.id);
		expect((await founding.state.findEngagement(founding.id)).assignment).toBeUndefined();
		const inactive = await subject();
		await inactive.subscriptions.markCancelledByUserId({ userId: inactive.id });
		await inactive.enroll(inactive.id);
		expect((await inactive.state.findEngagement(inactive.id)).assignment).toBeUndefined();
	});
	it("requires account age, observed inactivity, and fresh content at exact boundaries", async () => {
		const app = await subject({
			enroll: {
				findRollout: async () => ({
					...rollout,
					observationStartedAt: new Date(NOW.getTime() - STARTER_INACTIVITY_MS + 1).toISOString(),
				}),
			},
		});
		await app.enroll(app.id);
		expect((await app.state.findEngagement(app.id)).assignment).toBeUndefined();
		app.clock.now = new Date(NOW.getTime() + 1);
		await app.enroll(app.id);
		expect((await app.state.findEngagement(app.id)).assignment?.arm).toBe("treatment");
	});
	it("defers old and future snapshots and articles already saved anywhere", async () => {
		for (const age of [24 * 60 * 60 * 1000 + 1, -1]) {
			const app = await subject();
			app.picks.forEach((pick) => {
				pick.snapshotAt = new Date(NOW.getTime() - age).toISOString();
			});
			await app.enroll(app.id);
			expect((await app.state.findEngagement(app.id)).assignment).toBeUndefined();
		}
		const app = await subject();
		await app.library.createReadlistDefinition({
			userId: app.id,
			slug: ReadlistSlugSchema.parse("gmail"),
			label: "Gmail",
			createdAt: NOW,
		});
		const pick = app.picks[0];
		assert(pick);
		await app.library.saveReadlistArticle({
			userId: app.id,
			readlist: ReadlistSlugSchema.parse("gmail"),
			url: pick.url,
			metadata: { title: "Existing", siteName: "Gmail", excerpt: "", wordCount: 0 },
			estimatedReadTime: MinutesSchema.parse(1),
			savedAt: NOW,
			provenance: { kind: "email", senderEmail: "newsletter@example.com" },
		});
		await app.enroll(app.id);
		expect((await app.state.findEngagement(app.id)).assignment).toBeUndefined();
	});
	it("uses an available label and keeps read status synchronized after rename", async () => {
		const app = await subject();
		await app.library.createReadlistDefinition({
			userId: app.id,
			slug: ReadlistSlugSchema.parse("mine"),
			label: "Hacker News picks",
			createdAt: NOW,
		});
		await app.enroll(app.id);
		expect((await app.state.findStarterPack(app.id))?.readlistLabel).toBe("Hacker News picks 2");
		await app.library.renameReadlistDefinition({
			userId: app.id,
			slug: ReadlistSlugSchema.parse("hn-picks"),
			label: "Reading",
		});
		const pick = app.picks[0];
		assert(pick);
		await app.library.updateArticleStatusAcrossReadlists({
			userId: app.id,
			id: ReaderArticleHashId.from(pick.url),
			addressed: ReadlistSlugSchema.parse("hn-picks"),
			status: "read",
		});
		expect(
			(await app.library.findArticleById(ReaderArticleHashId.from(pick.url), app.id))?.status,
		).toBe("read");
		expect(
			(await app.library.listReadlistDefinitions(app.id)).find(
				(definition) => definition.slug === "hn-picks",
			)?.starterCampaignId,
		).toBe("hn-starter-v1");
	});
	it("keeps treatment failures assigned and re-evaluates on the next opportunity", async () => {
		const app = await subject({ enroll: { saveStarterPack: async () => "conflict" } });
		await app.enroll(app.id);
		await app.enroll(app.id);
		expect((await app.state.findEngagement(app.id)).assignment?.arm).toBe("treatment");
		expect(app.events.map((event) => event.event)).toEqual(["assigned", "failure", "failure"]);
	});
	it("records a storage failure without losing assignment", async () => {
		const app = await subject({
			enroll: {
				saveStarterPack: async () => {
					throw new Error("storage unavailable");
				},
			},
		});
		await expect(app.enroll(app.id)).rejects.toThrow("storage unavailable");
		expect((await app.state.findEngagement(app.id)).assignment?.arm).toBe("treatment");
		expect(app.events.at(-1)?.reason).toBe("insertion-failed");
	});
	it("does not enroll on a revision conflict", async () => {
		const app = await subject();
		app.enrollDeps.state = { ...app.state, assignStarter: async () => "conflict" };
		await initEnrollStarter(app.enrollDeps)(app.id);
		expect(app.events).toEqual([]);
	});
	it("refreshes an uninserted selection after a personal save, snapshot expiry, or readlist collision", async () => {
		for (const change of ["save", "expiry", "slug", "label"]) {
			const app = await subject();
			const insert = app.enrollDeps.saveStarterPack;
			app.enrollDeps.saveStarterPack = async () => "conflict";
			await app.enroll(app.id);
			const original = await app.state.findStarterPack(app.id);
			assert(original);
			const assignedAt = (await app.state.findEngagement(app.id)).assignment?.assignedAt;
			if (change === "save") {
				const pick = app.picks[0];
				assert(pick);
				await app.library.saveArticle({
					userId: app.id,
					url: pick.url,
					metadata: { title: "Personal", siteName: "Site", excerpt: "", wordCount: 0 },
					estimatedReadTime: MinutesSchema.parse(1),
					provenance: { kind: "web" },
					savedAt: NOW,
				});
				app.picks.push({
					url: "https://example.com/hn-extra",
					hnItemId: 200,
					rank: 11,
					snapshotAt: NOW.toISOString(),
				});
				await app.library.saveArticleGlobally({
					url: "https://example.com/hn-extra",
					metadata: { title: "Extra", siteName: "Site", excerpt: "", wordCount: 100 },
					estimatedReadTime: MinutesSchema.parse(1),
					savedAt: NOW,
				});
				await app.library.setReaderAvailableAt({ url: "https://example.com/hn-extra", at: NOW });
			}
			if (change === "expiry") {
				app.clock.now = new Date(NOW.getTime() + 24 * 60 * 60 * 1000 + 1);
				app.enrollDeps.findReadySnapshot = async () =>
					app.picks.map((pick) => ({ ...pick, snapshotAt: app.clock.now.toISOString() }));
			}
			if (change === "slug" || change === "label") {
				await app.library.createReadlistDefinition({
					userId: app.id,
					slug: ReadlistSlugSchema.parse(change === "slug" ? "hn-picks" : "mine"),
					label: change === "label" ? "Hacker News picks" : "My picks",
					createdAt: NOW,
				});
			}
			app.enrollDeps.newReadlistSlug = () => ReadlistSlugSchema.parse("fresh-picks");
			app.enrollDeps.saveStarterPack = insert;
			await app.enroll(app.id);
			const pack = await app.state.findStarterPack(app.id);
			assert(pack);
			expect(pack.insertedAt).toBe(app.clock.now.toISOString());
			expect(pack.readlist).toBe("fresh-picks");
			expect(pack.picks).toHaveLength(10);
			expect((await app.state.findEngagement(app.id)).assignment?.assignedAt).toBe(assignedAt);
			if (change === "save") {
				expect(pack.picks.some((pick) => pick.url === original.picks[0]?.url)).toBe(false);
			}
			if (change === "label") expect(pack.readlistLabel).toBe("Hacker News picks 2");
		}
	});
	it("leaves a selection alone when a concurrent retry has replaced it", async () => {
		const app = await subject({ enroll: { saveStarterPack: async () => "conflict" } });
		await app.enroll(app.id);
		await app.library.createReadlistDefinition({
			userId: app.id,
			slug: ReadlistSlugSchema.parse("hn-picks"),
			label: "Mine",
			createdAt: NOW,
		});
		app.enrollDeps.state = { ...app.state, replaceStarterSelection: async () => "conflict" };
		await app.enroll(app.id);
		expect(app.events.map((event) => event.event)).toEqual(["assigned", "failure"]);
	});
	it("retains an assignment when its pending selection is absent", async () => {
		const app = await subject({ enroll: { saveStarterPack: async () => "conflict" } });
		await app.enroll(app.id);
		app.enrollDeps.state = { ...app.state, findStarterPack: async () => undefined };
		await app.enroll(app.id);
		expect(app.events.map((event) => event.event)).toEqual(["assigned", "failure"]);
	});
	it("stops when account deletion removes the assignment before insertion", async () => {
		const app = await subject();
		let reads = 0;
		app.enrollDeps.state = {
			...app.state,
			findEngagement: async (id) => {
				if (reads++ > 0) app.state.deleteEngagement(id);
				return app.state.findEngagement(id);
			},
		};
		await app.enroll(app.id);
		expect((await app.library.findPersonalLibrary(app.id)).urls).toEqual([]);
	});
	it("defers insertion when meaningful activity follows assignment before the state refresh", async () => {
		const app = await subject();
		app.enrollDeps.state = {
			...app.state,
			assignStarter: async (input) => {
				const result = await app.state.assignStarter(input);
				await app.state.recordEngagementActivity({ userId: app.id, at: NOW, kind: "reader-open" });
				return result;
			},
		};
		await app.enroll(app.id);
		await app.enroll(app.id);
		expect((await app.library.findPersonalLibrary(app.id)).urls).toEqual([]);
		expect((await app.state.findEngagement(app.id)).assignment?.assignedAt).toBe(NOW.toISOString());
		expect((await app.state.findStarterPack(app.id))?.insertedAt).toBeUndefined();
		expect(app.events.map((event) => event.event)).toEqual(["assigned"]);
		app.clock.now = new Date(NOW.getTime() + STARTER_INACTIVITY_MS);
		app.enrollDeps.findReadySnapshot = async () =>
			app.picks.map((pick) => ({ ...pick, snapshotAt: app.clock.now.toISOString() }));
		await app.enroll(app.id);
		expect((await app.state.findStarterPack(app.id))?.insertedAt).toBe(app.clock.now.toISOString());
		expect((await app.state.findEngagement(app.id)).assignment?.assignedAt).toBe(NOW.toISOString());
	});
	it("prevents insertion when meaningful activity races the atomic write", async () => {
		const app = await subject();
		const insert = app.enrollDeps.saveStarterPack;
		app.enrollDeps.saveStarterPack = async (input) => {
			await app.state.recordEngagementActivity({ userId: app.id, at: NOW, kind: "reader-open" });
			return insert(input);
		};
		await app.enroll(app.id);
		await app.enroll(app.id);
		expect((await app.library.findPersonalLibrary(app.id)).urls).toEqual([]);
		expect((await app.state.findStarterPack(app.id))?.insertionOutcome).toBe("conflict");
		expect(app.events.map((event) => event.event)).toEqual(["assigned", "failure"]);
	});
	it("creates one pack under concurrent enrollment", async () => {
		const app = await subject();
		await Promise.all([app.enroll(app.id), app.enroll(app.id)]);
		expect((await app.library.findArticlesByUser({ userId: app.id })).articles).toHaveLength(10);
		expect(
			(
				await app.library.findReadlistArticles({
					userId: app.id,
					readlist: ReadlistSlugSchema.parse("hn-picks"),
				})
			).articles,
		).toHaveLength(10);
		expect(app.events.filter((event) => event.event === "assigned")).toHaveLength(1);
	});
});

describe("starter delivery", () => {
	it("sends immediately after insertion, with remaining count, summaries and owner links", async () => {
		const app = await subject();
		await app.enroll(app.id);
		const pick = app.picks[0];
		assert(pick);
		await app.library.updateArticleStatusAcrossReadlists({
			userId: app.id,
			id: ReaderArticleHashId.from(pick.url),
			addressed: DEFAULT_READLIST_SLUG,
			status: "read",
		});
		expect(await app.send(app.id)).toBe(true);
		const message = app.sent[0];
		assert(message);
		expect(message.from).toBe("Readplace <readplace@readplace.com>");
		expect(message.replyTo).toBe("fayner@readplace.com");
		expect(message.subject).toBe("Your Hacker News picks are ready");
		expect(message.text).toContain("9 picks are still unread");
		expect(message.text).toContain("A useful summary");
		expect(message.text).toContain("queue=hn-picks");
		expect(message.text).toContain("campaign=hn-starter-v1");
		expect(message.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
		await app.send(app.id);
		expect(app.sent).toHaveLength(1);
	});
	it.each([
		"preference",
		"access",
		"verification",
		"contact",
		"test-email",
		"deletion",
	])("rechecks %s before the first attempt", async (change) => {
		const app = await subject();
		await app.enroll(app.id);
		if (change === "deletion") app.contact.deletedAt = NOW.toISOString();
		if (change === "preference") app.contact.queueDigestOptOutAt = "opt-out";
		if (change === "verification") app.contact.emailVerified = false;
		if (change === "access") await app.subscriptions.markCancelledByUserId({ userId: app.id });
		if (change === "contact") app.sendDeps.findUserContactByUserId = async () => null;
		if (change === "test-email") app.contact.email = "reader@example.com";
		await app.send(app.id);
		expect(app.sent).toEqual([]);
		expect((await app.state.findStarterPack(app.id))?.emailStatus).toBe("suppressed");
	});
	it.each([
		"missing",
		"purged",
		"unreadable",
		"summary",
	])("excludes suggestions that became %s after insertion", async (change) => {
		const app = await subject();
		await app.enroll(app.id);
		const find = app.sendDeps.findArticleByUrl;
		app.sendDeps.findArticleByUrl = async (url) => {
			const article = await find(url);
			assert(article);
			if (change === "missing") return null;
			if (change === "purged") return { ...article, purgedAt: NOW };
			if (change === "unreadable") return { ...article, readerAvailableAt: undefined };
			return article;
		};
		if (change === "summary") app.sendDeps.findGeneratedSummary = async () => undefined;
		await app.send(app.id);
		expect(app.sent).toEqual([]);
		expect((await app.state.findStarterPack(app.id))?.reason).toBe("no-unread-picks");
	});
	it("waits for the 47.5-hour gap, including a previous payment digest", async () => {
		const app = await subject({
			send: {
				findReaderReadyEmailState: async () => ({
					lastSentAt: new Date(NOW.getTime() - STARTER_EMAIL_GAP_MS + 1),
					lastMessageId: "regular",
				}),
			},
		});
		await app.enroll(app.id);
		await app.send(app.id);
		expect(app.sent).toEqual([]);
		app.clock.now = new Date(NOW.getTime() + 1);
		await app.send(app.id);
		expect(app.sent).toHaveLength(1);
		const payment = await subject({
			send: {
				findSubscriptionByUserId: async () => ({
					userId,
					provider: "stripe",
					status: "active",
					createdAt: NOW.toISOString(),
					updatedAt: NOW.toISOString(),
					payDigestEmailSentAt: NOW.toISOString(),
				}),
			},
		});
		await payment.enroll(payment.id);
		await payment.send(payment.id);
		expect(payment.sent).toEqual([]);
	});
	it.each([
		47.5, 24, 0,
	])("preserves an unclaimed payment window opening in %s hours", async (hoursToWindow) => {
		const app = await subject();
		await app.enroll(app.id);
		await app.subscriptions.upsertTrialing({
			userId: app.id,
			trialEndsAt: new Date(NOW.getTime() + (96 + hoursToWindow) * 60 * 60 * 1000).toISOString(),
		});
		await app.send(app.id);
		expect(app.sent).toEqual([]);
		expect((await app.state.findStarterPack(app.id))?.emailStatus).toBe("pending");
	});
	it.each([
		["just beyond the 47.5-hour look-ahead", 96 + 47.5],
		["a week away", 96 + 168],
	])("sends a trial starter at once when the payment window opens %s", async (_name, hoursToTrialEnd) => {
		const app = await subject();
		await app.enroll(app.id);
		await app.subscriptions.upsertTrialing({
			userId: app.id,
			trialEndsAt: new Date(NOW.getTime() + hoursToTrialEnd * 60 * 60 * 1000 + 1).toISOString(),
		});
		await app.send(app.id);
		expect(app.sent).toHaveLength(1);
		expect((await app.state.findStarterPack(app.id))?.emailStatus).toBe("sent");
	});
	it("allows a starter after the unclaimed payment window closes", async () => {
		const app = await subject();
		await app.enroll(app.id);
		await app.subscriptions.upsertTrialing({
			userId: app.id,
			trialEndsAt: new Date(NOW.getTime() + 60 * 60 * 60 * 1000).toISOString(),
		});
		await app.send(app.id);
		expect(app.sent).toHaveLength(1);
	});
	it("permanently suppresses an empty pack even if memberships are later added", async () => {
		const app = await subject();
		await app.enroll(app.id);
		for (const pick of app.picks)
			await app.library.updateArticleStatusAcrossReadlists({
				userId: app.id,
				id: ReaderArticleHashId.from(pick.url),
				addressed: DEFAULT_READLIST_SLUG,
				status: "read",
			});
		await app.send(app.id);
		expect((await app.state.findStarterPack(app.id))?.reason).toBe("no-unread-picks");
		expect(app.sent).toEqual([]);
	});
	it("reuses a complete frozen message after a timeout and a bookkeeping failure", async () => {
		let calls = 0;
		const messages: EmailMessage[] = [];
		const app = await subject({
			send: {
				sendEmail: async (message) => {
					messages.push(message);
					if (calls++ === 0) throw new Error("timeout");
				},
			},
		});
		await app.enroll(app.id);
		await expect(app.send(app.id)).rejects.toThrow("timeout");
		expect(app.events.at(-1)?.reason).toBe("email-attempt-failed");
		app.contact.email = "changed@real.example";
		app.picks.length = 0;
		await app.send(app.id);
		expect(messages).toHaveLength(2);
		expect(messages[1]).toEqual(messages[0]);
		const bookkeeping = await subject();
		await bookkeeping.enroll(bookkeeping.id);
		bookkeeping.sendDeps.state = {
			...bookkeeping.state,
			markStarterEmailSent: async () => {
				throw new Error("bookkeeping");
			},
		};
		await expect(initSendStarter(bookkeeping.sendDeps)(bookkeeping.id)).rejects.toThrow(
			"bookkeeping",
		);
		expect(bookkeeping.events.slice(-2)).toMatchObject([
			{ event: "sent", itemCount: 10 },
			{ event: "failure", reason: "accepted-email-bookkeeping-failed" },
		]);
		bookkeeping.sendDeps.state = bookkeeping.state;
		await bookkeeping.send(bookkeeping.id);
		expect(bookkeeping.sent[1]).toEqual(bookkeeping.sent[0]);
	});
	it("puts unresolved attempts into operational review outside the provider window", async () => {
		const app = await subject({
			send: {
				sendEmail: async () => {
					throw new Error("timeout");
				},
			},
		});
		await app.enroll(app.id);
		await expect(app.send(app.id)).rejects.toThrow("timeout");
		app.clock.now = new Date(NOW.getTime() + STARTER_RETRY_WINDOW_MS);
		await app.send(app.id);
		expect((await app.state.findStarterPack(app.id))?.emailStatus).toBe("review");
		expect(await app.send(app.id)).toBe(false);
	});
	it("handles a lost notification claim", async () => {
		const app = await subject();
		await app.enroll(app.id);
		app.sendDeps.state = { ...app.state, claimStarterEmail: async () => undefined };
		await initSendStarter(app.sendDeps)(app.id);
		expect(app.sent).toEqual([]);
	});
	it.each([
		"preference",
		"empty",
		"expiry",
	])("preserves a concurrent attempt when a stale worker reaches %s suppression or review", async (change) => {
		const app = await subject({
			send: {
				sendEmail: async () => {
					throw new Error("timeout");
				},
			},
		});
		await app.enroll(app.id);
		await expect(app.send(app.id)).rejects.toThrow("timeout");
		const frozen = await app.state.findStarterPack(app.id);
		assert(frozen);
		if (change === "expiry") {
			await app.state.markStarterEmailSent({ userId: app.id, at: NOW });
			app.clock.now = new Date(NOW.getTime() + STARTER_RETRY_WINDOW_MS);
		}
		if (change === "preference") app.contact.queueDigestOptOutAt = NOW.toISOString();
		if (change === "empty") app.sendDeps.findArticleByUrl = async () => null;
		app.sendDeps.state = {
			...app.state,
			findStarterPack: async () =>
				change === "expiry"
					? frozen
					: {
							...frozen,
							emailStatus: "pending" as const,
							message: undefined,
							firstAttemptAt: undefined,
						},
		};
		await app.send(app.id);
		expect((await app.state.findStarterPack(app.id))?.emailStatus).toBe(
			change === "expiry" ? "sent" : "sending",
		);
		expect(app.events.at(-1)?.reason).toBe("email-attempt-failed");
	});
});

describe("permanent experiment policy", () => {
	it("keeps a stable 80/20 assignment", () => {
		expect(starterArm(UserIdSchema.parse("reader"))).toBe("treatment");
		expect(starterArm(UserIdSchema.parse("user-1"))).toBe("comparison");
		expect(starterArm(UserIdSchema.parse("reader"))).toBe("treatment");
	});
	it("splits treatment and comparison at the eightieth bucket", () => {
		expect(starterArm(UserIdSchema.parse("user-57"))).toBe("treatment");
		expect(starterArm(UserIdSchema.parse("user-27"))).toBe("comparison");
		const arms = Array.from({ length: 1000 }, (_, i) => starterArm(UserIdSchema.parse(`user-${i}`)));
		expect(arms.filter((arm) => arm === "treatment")).toHaveLength(795);
	});
	it("uses the latest of account age, observation and deliberate activity", () => {
		expect(
			hasStarterObservation({
				state: { activityRevision: 0 },
				registeredAt: "2020-01-01T00:00:00Z",
				now: NOW,
			}),
		).toBe(false);
		for (const kind of ["account", "observation", "activity"]) {
			const boundary = new Date(NOW.getTime() - STARTER_INACTIVITY_MS).toISOString();
			const older = "2020-01-01T00:00:00Z";
			expect(
				hasStarterObservation({
					state: {
						activityRevision: 1,
						observationStartedAt: kind === "observation" ? boundary : older,
						lastActivityAt: kind === "activity" ? boundary : undefined,
					},
					registeredAt: kind === "account" ? boundary : older,
					now: NOW,
				}),
			).toBe(true);
			expect(
				hasStarterObservation({
					state: {
						activityRevision: 1,
						observationStartedAt: kind === "observation" ? boundary : older,
						lastActivityAt: kind === "activity" ? boundary : undefined,
					},
					registeredAt: kind === "account" ? boundary : older,
					now: new Date(NOW.getTime() - 1),
				}),
			).toBe(false);
		}
	});
});
