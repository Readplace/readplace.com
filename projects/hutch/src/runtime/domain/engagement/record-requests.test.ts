import { UserIdSchema, type UserId } from "@packages/domain/user";
import { MinutesSchema, type SaveProvenance } from "@packages/domain/article";
import { OAuthClientIdSchema } from "@packages/domain/oauth";
import type { CountEarlyIntentionalSave, MarkActivationThresholdReached } from "@packages/provider-contracts/auth";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import type { RecordEngagementActivity } from "@packages/provider-contracts/engagement-starter";
import { initRecordPersonalSaves } from "./record-personal-saves";
import { initRecordImportRequest } from "./record-import-request";
import type { ActivationThresholdReachedEvent } from "./funnel-events";
import { ANALYTICS_EVENTS, STREAMS } from "../../observability/events";

const userId = UserIdSchema.parse("reader");
const NOW = new Date("2026-10-10T12:00:00.000Z");
const REGISTERED_AT = "2026-10-08T12:00:00.000Z";
const SIGNUP_CLIENT = OAuthClientIdSchema.parse("hutch-firefox-extension");
const activationNotObserved = {
	logError: () => {},
	countEarlyIntentionalSave: async () => ({ inWindow: false as const }),
	recordActivationThresholdReached: () => {},
	markActivationThresholdReached: async () => {},
};
const intentionalProvenance: SaveProvenance = { kind: "web" };
const saveParams = (url: string, provenance: SaveProvenance) => ({
	userId,
	url,
	metadata: { title: "Title", siteName: "Site", excerpt: "", wordCount: 200 },
	estimatedReadTime: MinutesSchema.parse(1),
	provenance,
	savedAt: NOW,
});
function activationHarness(
	counter?: CountEarlyIntentionalSave,
	markFailure?: Error,
) {
	const store = initInMemoryArticleStore();
	const activity: Parameters<RecordEngagementActivity>[0][] = [];
	const events: ActivationThresholdReachedEvent[] = [];
	const errors: { message: string; error: Error | undefined }[] = [];
	const counterCalls: Parameters<CountEarlyIntentionalSave>[0][] = [];
	const crossings: Parameters<MarkActivationThresholdReached>[0][] = [];
	let count = 0;
	const wrapped = initRecordPersonalSaves({
		...store,
		recordEngagementActivity: async (input) => {
			activity.push(input);
		},
		now: () => NOW,
		logError: (message, error) => {
			errors.push({ message, error });
		},
		countEarlyIntentionalSave: async (params) => {
			counterCalls.push(params);
			if (counter) return counter(params);
			count += 1;
			return { inWindow: true, count, registeredAt: REGISTERED_AT, signupOAuthClientId: SIGNUP_CLIENT };
		},
		recordActivationThresholdReached: (event) => {
			events.push(event);
		},
		markActivationThresholdReached: async (input) => {
			if (markFailure) throw markFailure;
			crossings.push(input);
		},
	});
	return { store, wrapped, activity, events, errors, counterCalls, crossings };
}
describe("deliberate requests", () => {
	it("records personal saves and imports, while preserving attribution and excluding background seeds and ingestion", async () => {
		const store = initInMemoryArticleStore();
		const activity: Parameters<RecordEngagementActivity>[0][] = [];
		const wrapped = initRecordPersonalSaves({
			...store,
			recordEngagementActivity: async (input) => {
				activity.push(input);
			},
			now: () => NOW,
			...activationNotObserved,
		});
		const params = {
			userId,
			url: "https://publisher.com/article",
			metadata: { title: "Title", siteName: "Site", excerpt: "", wordCount: 200 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" as const },
			savedAt: NOW,
		};
		await wrapped.saveArticle(params);
		await wrapped.saveArticle(params);
		expect(activity).toHaveLength(2);
		const suggestionAttribution = {
			campaignId: "hn-starter-v1",
			snapshotAt: NOW.toISOString(),
			hnItemId: 1,
			rank: 1,
		};
		await wrapped.saveReadlistArticle({
			...params,
			url: "https://publisher.com/personal",
			readlist: ReadlistSlugSchema.parse("work"),
			suggestionAttribution,
		});
		await wrapped.saveArticleKeepingPosition({
			...params,
			url: "https://publisher.com/import",
			provenance: { kind: "import" },
		});
		expect(activity).toHaveLength(4);
		expect(activity[2]).toMatchObject({ kind: "personal-save", campaignId: "hn-starter-v1" });
		for (const provenance of [
			{ kind: "email", senderEmail: "newsletter@sender.com" },
			{ kind: "hn-suggestion", ...suggestionAttribution },
			{ kind: "founder-seed" },
		] as const)
			await wrapped.saveArticle({
				...params,
				url: `https://publisher.com/${provenance.kind}`,
				provenance,
			});
		expect(activity).toHaveLength(4);
	});
	it("records authenticated import requests after success without attributing an anonymous upload", async () => {
		const activity: Parameters<RecordEngagementActivity>[0][] = [];
		const request = initRecordImportRequest({
			request: async (input: { userId: UserId | undefined; value: string }) => input.value,
			recordEngagementActivity: async (input) => {
				activity.push(input);
			},
			now: () => NOW,
		});
		expect(await request({ userId, value: "job" })).toBe("job");
		expect(await request({ userId: undefined, value: "upload" })).toBe("upload");
		expect(activity).toEqual([{ userId, at: NOW, kind: "import-request" }]);
	});
	it("records deliberate filing across All and custom lists while retaining suggestion provenance", async () => {
		const store = initInMemoryArticleStore();
		const activity: Parameters<RecordEngagementActivity>[0][] = [];
		const wrapped = initRecordPersonalSaves({
			...store,
			recordEngagementActivity: async (input) => {
				activity.push(input);
			},
			now: () => NOW,
			...activationNotObserved,
		});
		const work = ReadlistSlugSchema.parse("work");
		const later = ReadlistSlugSchema.parse("later");
		await store.createReadlistDefinition({ userId, slug: work, label: "Work", createdAt: NOW });
		await store.createReadlistDefinition({ userId, slug: later, label: "Later", createdAt: NOW });
		const attribution = {
			campaignId: "hn-starter-v1",
			snapshotAt: NOW.toISOString(),
			hnItemId: 1,
			rank: 1,
		};
		const saved = await store.saveArticle({
			userId,
			url: "https://publisher.com/suggestion",
			metadata: { title: "Title", siteName: "Site", excerpt: "", wordCount: 200 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "hn-suggestion", ...attribution },
			suggestionAttribution: attribution,
			savedAt: NOW,
		});
		const params = {
			userId,
			url: saved.saved.url,
			from: DEFAULT_READLIST_SLUG,
			readlist: work,
			savedAt: NOW,
		};
		expect(await wrapped.assignSavedArticleToReadlist(params)).toEqual({ assigned: true });
		expect(await wrapped.assignSavedArticleToReadlist(params)).toEqual({ assigned: false });
		expect(
			await wrapped.assignSavedArticleToReadlist({ ...params, from: work, readlist: later }),
		).toEqual({ assigned: true });
		expect(activity).toEqual(
			Array.from({ length: 3 }, () => ({
				userId,
				kind: "personal-save",
				at: NOW,
				articleId: saved.saved.id,
				campaignId: attribution.campaignId,
			})),
		);
		expect(
			await store.findReadlistArticleById({ userId, id: saved.saved.id, readlist: later }),
		).toMatchObject({ provenance: { kind: "hn-suggestion" }, suggestionAttribution: attribution });
		expect((await store.findPersonalLibrary(userId)).personalCount).toBe(0);
		expect(
			await wrapped.assignSavedArticleToReadlist({
				...params,
				url: "https://publisher.com/missing",
			}),
		).toEqual({ assigned: false });
		expect(activity).toHaveLength(3);
		const personal = await store.saveArticle({
			userId,
			url: "https://publisher.com/personal",
			metadata: { title: "Title", siteName: "Site", excerpt: "", wordCount: 200 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: NOW,
		});
		await wrapped.assignSavedArticleToReadlist({ ...params, url: personal.saved.url });
		expect(activity.at(-1)).toMatchObject({ articleId: personal.saved.id, campaignId: undefined });
	});
});

describe("the second intentional save", () => {
	const suggestion = { campaignId: "hn-starter-v1", snapshotAt: NOW.toISOString(), hnItemId: 1, rank: 1 };

	it.each<[string, SaveProvenance]>([
		["web", { kind: "web" }],
		["client", { kind: "client", clientName: "firefox" }],
		["mcp", { kind: "mcp", registeredName: "Claude" }],
	])("records one event on the second created %s save and none on the third", async (_kind, provenance) => {
		const { wrapped, events, counterCalls } = activationHarness();

		await wrapped.saveArticle(saveParams("https://publisher.com/one", provenance));
		expect(events).toEqual([]);
		await wrapped.saveArticleKeepingPosition(saveParams("https://publisher.com/two", provenance));
		await wrapped.saveArticle(saveParams("https://publisher.com/three", provenance));

		expect(events).toEqual([
			{
				stream: STREAMS.analytics,
				event: ANALYTICS_EVENTS.activationThresholdReached,
				timestamp: NOW.toISOString(),
				user_id: userId,
				oauth_client_id: SIGNUP_CLIENT,
				hours_since_signup: 48,
			},
		]);
		expect(counterCalls).toEqual([
			{ userId, at: NOW },
			{ userId, at: NOW },
			{ userId, at: NOW },
		]);
	});

	it.each<[string, SaveProvenance]>([
		["import", { kind: "import" }],
		["email", { kind: "email", senderEmail: "newsletter@sender.com" }],
		["hn-suggestion", { kind: "hn-suggestion", ...suggestion }],
		["founder-seed", { kind: "founder-seed" }],
	])("does not call the counter for a %s save", async (_kind, provenance) => {
		const { wrapped, counterCalls } = activationHarness();

		await wrapped.saveArticle(saveParams("https://publisher.com/excluded", provenance));
		await wrapped.saveArticleKeepingPosition(saveParams("https://publisher.com/excluded-2", provenance));

		expect(counterCalls).toEqual([]);
	});

	it("marks the crossing on the row on the second created save only", async () => {
		const { wrapped, crossings } = activationHarness();

		await wrapped.saveArticle(saveParams("https://publisher.com/one", intentionalProvenance));
		expect(crossings).toEqual([]);
		await wrapped.saveArticleKeepingPosition(saveParams("https://publisher.com/two", intentionalProvenance));
		expect(crossings).toEqual([{ userId, at: NOW }]);
		await wrapped.saveArticle(saveParams("https://publisher.com/three", intentionalProvenance));
		expect(crossings).toEqual([{ userId, at: NOW }]);
	});

	it("marks no crossing outside the window", async () => {
		const { wrapped, crossings } = activationHarness(async () => ({ inWindow: false }));

		await wrapped.saveArticle(saveParams("https://publisher.com/one", intentionalProvenance));
		await wrapped.saveArticle(saveParams("https://publisher.com/two", intentionalProvenance));

		expect(crossings).toEqual([]);
	});

	it("keeps the save and the activation event when marking the crossing fails, and logs the failure", async () => {
		const unavailable = new Error("Users table unavailable");
		const { wrapped, events, errors } = activationHarness(undefined, unavailable);

		await wrapped.saveArticle(saveParams("https://publisher.com/one", intentionalProvenance));
		const second = await wrapped.saveArticle(saveParams("https://publisher.com/two", intentionalProvenance));

		expect(second.createdUserArticle).toBe(true);
		expect(events).toHaveLength(1);
		expect(errors).toEqual([{ message: "Failed to count early intentional save", error: unavailable }]);
	});

	it("does not count a re-save", async () => {
		const { wrapped, counterCalls } = activationHarness();
		const params = saveParams("https://publisher.com/again", { kind: "web" });

		await wrapped.saveArticle(params);
		await wrapped.saveArticle(params);

		expect(counterCalls).toHaveLength(1);
	});

	it("records nothing outside the window", async () => {
		const { wrapped, events, errors } = activationHarness(async () => ({ inWindow: false }));

		await wrapped.saveArticle(saveParams("https://publisher.com/late", { kind: "web" }));

		expect(events).toEqual([]);
		expect(errors).toEqual([]);
	});

	it("does not count filing a save into another readlist", async () => {
		const { store, wrapped, activity, counterCalls } = activationHarness();
		const work = ReadlistSlugSchema.parse("work");
		await store.createReadlistDefinition({ userId, slug: work, label: "Work", createdAt: NOW });
		const params = saveParams("https://publisher.com/filed", { kind: "web" });
		await store.saveArticle(params);

		await wrapped.assignSavedArticleToReadlist({
			userId,
			url: params.url,
			from: DEFAULT_READLIST_SLUG,
			readlist: work,
			savedAt: NOW,
		});

		expect(activity).toHaveLength(1);
		expect(counterCalls).toEqual([]);
	});

	it("keeps the engagement write of a created saveReadlistArticle without counting it", async () => {
		const { store, wrapped, activity, counterCalls } = activationHarness();
		const work = ReadlistSlugSchema.parse("work");
		await store.createReadlistDefinition({ userId, slug: work, label: "Work", createdAt: NOW });

		const result = await wrapped.saveReadlistArticle({
			...saveParams("https://publisher.com/custom", { kind: "web" }),
			readlist: work,
		});

		expect(result.createdUserArticle).toBe(true);
		expect(activity).toHaveLength(1);
		expect(counterCalls).toEqual([]);
	});

	it.each<[string, unknown, Error | undefined]>([
		["an Error", new Error("dynamodb down"), new Error("dynamodb down")],
		["a non-Error", "dynamodb down", undefined],
	])("logs a counter that throws %s, records nothing and still returns the save", async (_label, thrown, logged) => {
		const { wrapped, events, errors } = activationHarness(async () => {
			throw thrown;
		});

		const result = await wrapped.saveArticle(saveParams("https://publisher.com/survives", { kind: "web" }));

		expect(result.saved.url).toBe("https://publisher.com/survives");
		expect(events).toEqual([]);
		expect(errors).toEqual([{ message: "Failed to count early intentional save", error: logged }]);
	});
});
