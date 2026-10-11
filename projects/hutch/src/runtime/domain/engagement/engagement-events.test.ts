import { UserIdSchema } from "@packages/domain/user";
import { ReaderArticleHashId } from "@packages/domain/article";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initInMemoryEngagementStarter } from "@packages/test-fixtures/providers/onboarding-signals";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	initEngagementEvents,
	initRecordEngagementActivity,
	type EngagementEvent,
} from "./engagement-events";
import { STARTER_CAMPAIGN_ID } from "./starter-policy";

const now = new Date("2026-10-10T12:00:00.000Z");
const userId = UserIdSchema.parse("reader");
describe("account activity measurement", () => {
	it("emits stable campaign and account identifiers for every campaign outcome", () => {
		const events: EngagementEvent[] = [];
		const capture = (event: EngagementEvent) => {
			events.push(event);
		};
		const logger: HutchLogger.Typed<EngagementEvent> = {
			info: capture,
			warn: capture,
			error: capture,
			debug: capture,
		};
		const emit = initEngagementEvents({ logger, now: () => now });
		for (const event of ["assigned", "inserted", "suppressed", "failure", "sent"] as const)
			emit({ userId, event, arm: "treatment", itemCount: 10 });
		emit({ userId, event: "failure", campaignId: "campaign", reason: "timeout" });
		expect(events[0]).toMatchObject({
			user_id: userId,
			campaign_id: "hn-starter-v1",
			event: "starter_assigned",
			timestamp: now.toISOString(),
		});
		expect(events.at(-1)).toMatchObject({ campaign_id: "campaign", reason: "timeout" });
	});
	it("distinguishes primary outcomes from visits and carries immutable article attribution", async () => {
		const state = initInMemoryEngagementStarter({ library: initInMemoryArticleStore() });
		const events: EngagementEvent[] = [];
		const capture = (event: EngagementEvent) => {
			events.push(event);
		};
		const record = initRecordEngagementActivity({
			state,
			logger: { info: capture, warn: capture, debug: capture, error: capture },
		});
		await record({ userId, kind: "reader-open", at: now });
		expect(events[0]).toMatchObject({ campaign_id: "hn-starter-v1", qualifies_activation: false });
		await state.observeEngagement({ userId, startedAt: now.toISOString() });
		await state.assignStarter({
			userId,
			revision: 2,
			assignment: {
				campaignId: STARTER_CAMPAIGN_ID,
				arm: "comparison",
				tier: "trial",
				accountCohort: "new",
				assignedAt: now.toISOString(),
			},
			pack: {
				campaignId: STARTER_CAMPAIGN_ID,
				picks: [],
				readlist: ReadlistSlugSchema.parse("picks"),
				readlistLabel: "Picks",
				selectedAt: now.toISOString(),
				emailStatus: "pending",
			},
		});
		for (const kind of [
			"personal-save",
			"mcp-content",
			"mcp-summary",
			"read-status",
			"import-request",
		] as const)
			await record({
				userId,
				kind,
				at: now,
				markedRead: kind === "read-status",
				articleId: ReaderArticleHashId.from("https://publisher.com/article"),
			});
		await record({ userId, kind: "summary-open", at: now, campaignId: STARTER_CAMPAIGN_ID });
		expect(events[1]).toMatchObject({
			campaign_id: STARTER_CAMPAIGN_ID,
			arm: "comparison",
			qualifies_activation: true,
		});
		expect(events[4]).toMatchObject({ qualifies_activation: true, marked_read: true });
		expect(events.at(-1)).toMatchObject({
			campaign_id: STARTER_CAMPAIGN_ID,
			qualifies_activation: false,
		});
		await record({ userId, kind: "read-status", at: now, markedRead: false });
		await record({ userId, kind: "personal-save", at: new Date(now.getTime() + 7 * 86_400_000) });
		expect(events.slice(-2).every((event) => event.qualifies_activation === false)).toBe(true);
	});
	it("keeps the assigned campaign on every activity and marks the ones that act on a suggestion", async () => {
		const state = initInMemoryEngagementStarter({ library: initInMemoryArticleStore() });
		const events: EngagementEvent[] = [];
		const capture = (event: EngagementEvent) => {
			events.push(event);
		};
		const record = initRecordEngagementActivity({
			state,
			logger: { info: capture, warn: capture, debug: capture, error: capture },
		});
		await state.assignStarter({
			userId,
			revision: 0,
			assignment: {
				campaignId: STARTER_CAMPAIGN_ID,
				arm: "treatment",
				tier: "trial",
				accountCohort: "existing",
				assignedAt: now.toISOString(),
			},
			pack: {
				campaignId: STARTER_CAMPAIGN_ID,
				picks: [],
				readlist: ReadlistSlugSchema.parse("hn-picks"),
				readlistLabel: "Hacker News picks",
				selectedAt: now.toISOString(),
				emailStatus: "pending",
			},
		});

		await record({
			userId,
			kind: "read-status",
			at: now,
			markedRead: true,
			articleId: ReaderArticleHashId.from("https://publisher.com/pick"),
			campaignId: STARTER_CAMPAIGN_ID,
		});
		await record({
			userId,
			kind: "read-status",
			at: now,
			markedRead: true,
			articleId: ReaderArticleHashId.from("https://publisher.com/personal"),
		});

		expect(events.map((event) => ({ campaign: event.campaign_id, onSuggestion: event.on_suggestion }))).toEqual([
			{ campaign: STARTER_CAMPAIGN_ID, onSuggestion: true },
			{ campaign: STARTER_CAMPAIGN_ID, onSuggestion: false },
		]);
	});
});
