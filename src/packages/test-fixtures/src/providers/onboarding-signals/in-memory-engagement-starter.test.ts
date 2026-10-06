import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema, type UserId } from "@packages/domain/user";
import type {
	RecordEngagementActivity,
	SaveStarterPack,
	StarterAssignment,
	StarterPack,
} from "@packages/provider-contracts/engagement-starter";
import { initInMemoryEngagementStarter } from "./in-memory-engagement-starter";

const USER = "user-1" as UserId;
const ASSIGNED_AT = new Date("2026-10-01T09:00:00.000Z");

const PENDING_PACK: StarterPack = {
	campaignId: "hn-starter-v1",
	picks: [
		{
			url: "https://example.com/pick",
			hnItemId: 41_000_001,
			rank: 1,
			snapshotAt: "2026-10-01T08:00:00.000Z",
		},
	],
	readlist: ReadlistSlugSchema.parse("hn-picks"),
	readlistLabel: "Hacker News picks",
	selectedAt: "2026-10-01T09:00:00.000Z",
	emailStatus: "pending",
};

const STARTER_MESSAGE = {
	from: "Readplace <hello@readplace.com>",
	to: "reader@example.com",
	replyTo: "hello@readplace.com",
	subject: "Your Hacker News picks are ready",
	html: "<p>Your Hacker News picks are ready</p>",
	text: "Your Hacker News picks are ready",
	headers: {},
	idempotencyKey: "starter/user-1",
};

function assignment(arm: StarterAssignment["arm"]): StarterAssignment {
	return {
		campaignId: "hn-starter-v1",
		arm,
		assignedAt: ASSIGNED_AT.toISOString(),
		tier: "trial",
		accountCohort: "existing",
	};
}

function daysAfterAssignment(days: number): Date {
	return new Date(ASSIGNED_AT.getTime() + days * 86_400_000);
}

type Library = { saveStarterPack: SaveStarterPack };

const ACCEPTING_LIBRARY: Library = { saveStarterPack: async () => "inserted" };

function insertionOf(pack: StarterPack, at: Date): Parameters<SaveStarterPack>[0] {
	return { userId: USER, activityRevision: 1, pack, savedAt: pack.picks.map(() => at), at };
}

async function starterAssigned(arm: StarterAssignment["arm"], library = ACCEPTING_LIBRARY) {
	const starter = initInMemoryEngagementStarter({ library });
	await starter.assignStarter({
		userId: USER,
		revision: 0,
		assignment: assignment(arm),
		pack: PENDING_PACK,
	});
	return starter;
}

describe("initInMemoryEngagementStarter", () => {
	it("starts an account unobserved at activity revision zero", async () => {
		const starter = initInMemoryEngagementStarter({ library: ACCEPTING_LIBRARY });

		expect(await starter.findEngagement(USER)).toEqual({ activityRevision: 0 });
		expect(await starter.listStarterObservations("hn-starter-v1")).toEqual([]);
	});

	it("lists only accounts assigned to the requested campaign", async () => {
		const starter = await starterAssigned("comparison");
		await starter.observeEngagement({
			userId: UserIdSchema.parse("unassigned"),
			startedAt: "2026-10-01T09:00:00.000Z",
		});

		expect(await starter.listStarterObservations("hn-starter-v1")).toEqual([
			{
				userId: USER,
				engagement: { activityRevision: 1, assignment: assignment("comparison") },
				starterPack: undefined,
			},
		]);
		expect(await starter.listStarterObservations("another-campaign")).toEqual([]);
	});

	it("keeps the first observation start while each observation advances the activity revision", async () => {
		const starter = initInMemoryEngagementStarter({ library: ACCEPTING_LIBRARY });

		await starter.observeEngagement({ userId: USER, startedAt: "2026-10-01T09:00:00.000Z" });
		const observed = await starter.observeEngagement({
			userId: USER,
			startedAt: "2026-10-02T09:00:00.000Z",
		});

		expect(observed).toEqual({
			observationStartedAt: "2026-10-01T09:00:00.000Z",
			activityRevision: 2,
		});
	});

	it("tracks the latest activity of an unassigned account without activating it", async () => {
		const starter = initInMemoryEngagementStarter({ library: ACCEPTING_LIBRARY });

		await starter.recordEngagementActivity({
			userId: USER,
			kind: "personal-save",
			at: new Date("2026-10-02T09:00:00.000Z"),
		});
		await starter.recordEngagementActivity({
			userId: USER,
			kind: "summary-open",
			at: new Date("2026-10-01T09:00:00.000Z"),
		});

		expect(await starter.findEngagement(USER)).toEqual({
			activityRevision: 2,
			lastActivityAt: "2026-10-02T09:00:00.000Z",
		});
	});

	it.each<Pick<Parameters<RecordEngagementActivity>[0], "kind" | "markedRead">>([
		{ kind: "personal-save" },
		{ kind: "read-status", markedRead: true },
		{ kind: "mcp-content" },
		{ kind: "mcp-summary" },
	])("activates an assigned account on its first $kind within seven days", async (activity) => {
		const starter = await starterAssigned("treatment");

		await starter.recordEngagementActivity({ userId: USER, ...activity, at: daysAfterAssignment(6) });
		await starter.recordEngagementActivity({
			userId: USER,
			kind: "personal-save",
			at: daysAfterAssignment(6.5),
		});

		expect((await starter.findEngagement(USER)).activatedAt).toBe(
			daysAfterAssignment(6).toISOString(),
		);
	});

	it("does not count opening an article or its summary, or marking it unread, as activation", async () => {
		const starter = await starterAssigned("treatment");

		await starter.recordEngagementActivity({
			userId: USER,
			kind: "reader-open",
			at: daysAfterAssignment(1),
		});
		await starter.recordEngagementActivity({
			userId: USER,
			kind: "summary-open",
			at: daysAfterAssignment(2),
		});
		await starter.recordEngagementActivity({
			userId: USER,
			kind: "read-status",
			markedRead: false,
			at: daysAfterAssignment(3),
		});

		expect(await starter.findEngagement(USER)).toEqual({
			assignment: assignment("treatment"),
			activityRevision: 4,
			lastActivityAt: daysAfterAssignment(3).toISOString(),
		});
	});

	it("records the first activity in days eight to fourteen without activating the account late", async () => {
		const starter = await starterAssigned("comparison");

		await starter.recordEngagementActivity({
			userId: USER,
			kind: "personal-save",
			at: daysAfterAssignment(7),
		});
		await starter.recordEngagementActivity({
			userId: USER,
			kind: "reader-open",
			at: daysAfterAssignment(13),
		});
		await starter.recordEngagementActivity({
			userId: USER,
			kind: "reader-open",
			at: daysAfterAssignment(14),
		});

		expect(await starter.findEngagement(USER)).toEqual({
			assignment: assignment("comparison"),
			activityRevision: 4,
			lastActivityAt: daysAfterAssignment(14).toISOString(),
			engagedDays8To14At: daysAfterAssignment(7).toISOString(),
		});
	});

	it("assigns an account once, at the activity revision it was judged on", async () => {
		const starter = initInMemoryEngagementStarter({ library: ACCEPTING_LIBRARY });
		await starter.observeEngagement({ userId: USER, startedAt: "2026-09-28T09:00:00.000Z" });
		await starter.recordEngagementActivity({
			userId: USER,
			kind: "reader-open",
			at: new Date("2026-09-29T09:00:00.000Z"),
		});

		const stale = await starter.assignStarter({
			userId: USER,
			revision: 1,
			assignment: assignment("treatment"),
			pack: PENDING_PACK,
		});
		const current = await starter.assignStarter({
			userId: USER,
			revision: 2,
			assignment: assignment("treatment"),
			pack: PENDING_PACK,
		});
		const repeated = await starter.assignStarter({
			userId: USER,
			revision: 3,
			assignment: assignment("comparison"),
			pack: PENDING_PACK,
		});

		expect([stale, current, repeated]).toEqual(["conflict", "assigned", "conflict"]);
		expect(await starter.listStarterObservations("hn-starter-v1")).toEqual([
			{
				userId: USER,
				engagement: {
					observationStartedAt: "2026-09-28T09:00:00.000Z",
					lastActivityAt: "2026-09-29T09:00:00.000Z",
					activityRevision: 3,
					assignment: assignment("treatment"),
				},
				starterPack: PENDING_PACK,
			},
		]);
	});

	it("keeps no starter pack for the comparison arm", async () => {
		const starter = await starterAssigned("comparison");

		expect(await starter.findStarterPack(USER)).toBeUndefined();
	});

	it("replaces a pending selection only when the caller names the selection it judged", async () => {
		const starter = await starterAssigned("treatment");
		const reselected = { ...PENDING_PACK, selectedAt: "2026-10-02T09:00:00.000Z" };

		const fromOtherSelection = await starter.replaceStarterSelection({
			userId: USER,
			selectedAt: "2026-09-30T09:00:00.000Z",
			pack: reselected,
		});
		const fromJudgedSelection = await starter.replaceStarterSelection({
			userId: USER,
			selectedAt: PENDING_PACK.selectedAt,
			pack: reselected,
		});

		expect([fromOtherSelection, fromJudgedSelection]).toEqual(["conflict", "replaced"]);
		expect(await starter.findStarterPack(USER)).toEqual(reselected);
	});

	it("files a pending treatment selection through the library and marks it inserted", async () => {
		const filed: Parameters<SaveStarterPack>[0][] = [];
		const starter = await starterAssigned("treatment", {
			saveStarterPack: async (input) => {
				filed.push(input);
				return "inserted";
			},
		});
		const insertedAt = daysAfterAssignment(0);

		const first = await starter.saveStarterPack(insertionOf(PENDING_PACK, insertedAt));
		const repeated = await starter.saveStarterPack(
			insertionOf(PENDING_PACK, daysAfterAssignment(1)),
		);

		expect([first, repeated]).toEqual(["inserted", "conflict"]);
		expect(filed).toEqual([insertionOf(PENDING_PACK, insertedAt)]);
		expect(await starter.findStarterPack(USER)).toEqual({
			...PENDING_PACK,
			insertedAt: insertedAt.toISOString(),
			insertionOutcome: "inserted",
			lastInsertionAttemptAt: insertedAt.toISOString(),
		});
	});

	it.each<{
		conflict: string;
		arrange: (library: Library) => Promise<ReturnType<typeof initInMemoryEngagementStarter>>;
		pack?: StarterPack;
	}>([
		{
			conflict: "activity moved on from the revision it was judged at",
			arrange: async (library) => {
				const starter = await starterAssigned("treatment", library);
				await starter.recordEngagementActivity({
					userId: USER,
					kind: "reader-open",
					at: daysAfterAssignment(0),
				});
				return starter;
			},
		},
		{
			conflict: "the account is in the comparison arm",
			arrange: (library) => starterAssigned("comparison", library),
		},
		{
			conflict: "the account is assigned to another campaign",
			arrange: async (library) => {
				const starter = initInMemoryEngagementStarter({ library });
				await starter.assignStarter({
					userId: USER,
					revision: 0,
					assignment: { ...assignment("treatment"), campaignId: "hn-starter-v2" },
					pack: PENDING_PACK,
				});
				return starter;
			},
		},
		{
			conflict: "the frozen selection belongs to another campaign",
			arrange: async (library) => {
				const starter = initInMemoryEngagementStarter({ library });
				await starter.assignStarter({
					userId: USER,
					revision: 0,
					assignment: assignment("treatment"),
					pack: { ...PENDING_PACK, campaignId: "hn-starter-v0" },
				});
				return starter;
			},
		},
		{
			conflict: "another selection replaced the one it judged",
			arrange: (library) => starterAssigned("treatment", library),
			pack: { ...PENDING_PACK, selectedAt: "2026-10-02T09:00:00.000Z" },
		},
		{
			conflict: "the starter email already left pending",
			arrange: async (library) => {
				const starter = await starterAssigned("treatment", library);
				await starter.suppressStarterEmail({ userId: USER, reason: "unsubscribed" });
				return starter;
			},
		},
	])("files nothing when $conflict", async ({ arrange, pack = PENDING_PACK }) => {
		const filed: Parameters<SaveStarterPack>[0][] = [];
		const starter = await arrange({
			saveStarterPack: async (input) => {
				filed.push(input);
				return "inserted";
			},
		});
		const before = await starter.findStarterPack(USER);

		const outcome = await starter.saveStarterPack(insertionOf(pack, daysAfterAssignment(0)));

		expect(outcome).toBe("conflict");
		expect(filed).toEqual([]);
		expect(await starter.findStarterPack(USER)).toEqual(before);
	});

	it("leaves the selection uninserted when the library refuses its rows", async () => {
		const starter = await starterAssigned("treatment", {
			saveStarterPack: async () => "conflict",
		});

		const outcome = await starter.saveStarterPack(
			insertionOf(PENDING_PACK, daysAfterAssignment(0)),
		);

		expect(outcome).toBe("conflict");
		expect(await starter.findStarterPack(USER)).toEqual(PENDING_PACK);
	});

	it("refuses to replace a selection once it was inserted or its email left pending", async () => {
		const inserted = await starterAssigned("treatment");
		await inserted.saveStarterPack(insertionOf(PENDING_PACK, daysAfterAssignment(0)));
		const suppressed = await starterAssigned("treatment");
		await suppressed.suppressStarterEmail({ userId: USER, reason: "unsubscribed" });

		expect(
			await inserted.replaceStarterSelection({
				userId: USER,
				selectedAt: PENDING_PACK.selectedAt,
				pack: PENDING_PACK,
			}),
		).toBe("conflict");
		expect(
			await suppressed.replaceStarterSelection({
				userId: USER,
				selectedAt: PENDING_PACK.selectedAt,
				pack: PENDING_PACK,
			}),
		).toBe("conflict");
	});

	it("records a failed insertion only against the selection it attempted", async () => {
		const starter = await starterAssigned("treatment");
		const attemptedAt = daysAfterAssignment(0);

		await starter.recordStarterInsertionFailure({
			userId: USER,
			selectedAt: PENDING_PACK.selectedAt,
			at: attemptedAt,
			outcome: "conflict",
		});
		await starter.recordStarterInsertionFailure({
			userId: USER,
			selectedAt: "2026-09-30T09:00:00.000Z",
			at: daysAfterAssignment(1),
			outcome: "failed",
		});

		expect(await starter.findStarterPack(USER)).toEqual({
			...PENDING_PACK,
			insertionOutcome: "conflict",
			lastInsertionAttemptAt: attemptedAt.toISOString(),
		});
	});

	it("keeps a completed insertion when a late failure arrives", async () => {
		const starter = await starterAssigned("treatment");
		const insertedAt = daysAfterAssignment(0);
		await starter.saveStarterPack(insertionOf(PENDING_PACK, insertedAt));

		await starter.recordStarterInsertionFailure({
			userId: USER,
			selectedAt: PENDING_PACK.selectedAt,
			at: daysAfterAssignment(1),
			outcome: "failed",
		});

		expect(await starter.findStarterPack(USER)).toEqual({
			...PENDING_PACK,
			insertedAt: insertedAt.toISOString(),
			insertionOutcome: "inserted",
			lastInsertionAttemptAt: insertedAt.toISOString(),
		});
	});

	it("freezes the first claimed message so a retried send repeats it", async () => {
		const starter = await starterAssigned("treatment");
		const firstAttemptAt = daysAfterAssignment(0);

		const claimed = await starter.claimStarterEmail({
			userId: USER,
			message: STARTER_MESSAGE,
			at: firstAttemptAt,
			minGapMs: 0,
			itemCount: 10,
		});
		const retried = await starter.claimStarterEmail({
			userId: USER,
			message: { ...STARTER_MESSAGE, subject: "A different subject" },
			at: daysAfterAssignment(1),
			minGapMs: 0,
			itemCount: 9,
		});

		const frozen = {
			...PENDING_PACK,
			message: STARTER_MESSAGE,
			emailStatus: "sending",
			firstAttemptAt: firstAttemptAt.toISOString(),
			itemCount: 10,
		};
		expect(claimed).toEqual(frozen);
		expect(retried).toEqual(frozen);
	});

	it("claims no email for an account without a pack or once its email was sent", async () => {
		const withoutPack = await starterAssigned("comparison");
		const sent = await starterAssigned("treatment");
		await sent.claimStarterEmail({
			userId: USER,
			message: STARTER_MESSAGE,
			at: daysAfterAssignment(0),
			minGapMs: 0,
			itemCount: 10,
		});
		await sent.markStarterEmailSent({ userId: USER, at: daysAfterAssignment(0) });

		expect(
			await withoutPack.claimStarterEmail({
				userId: USER,
				message: STARTER_MESSAGE,
				at: daysAfterAssignment(1),
				minGapMs: 0,
				itemCount: 10,
			}),
		).toBeUndefined();
		expect(
			await sent.claimStarterEmail({
				userId: USER,
				message: STARTER_MESSAGE,
				at: daysAfterAssignment(1),
				minGapMs: 0,
				itemCount: 10,
			}),
		).toBeUndefined();
	});

	it("suppresses only an email that is still pending", async () => {
		const starter = await starterAssigned("treatment");

		const first = await starter.suppressStarterEmail({ userId: USER, reason: "unsubscribed" });
		const second = await starter.suppressStarterEmail({ userId: USER, reason: "bounced" });

		expect([first, second]).toEqual([true, false]);
		expect(await starter.findStarterPack(USER)).toEqual({
			...PENDING_PACK,
			emailStatus: "suppressed",
			reason: "unsubscribed",
		});
	});

	it("marks an email sent only while it is being sent", async () => {
		const starter = await starterAssigned("treatment");
		const sentAt = daysAfterAssignment(0);

		const beforeClaim = await starter.markStarterEmailSent({ userId: USER, at: sentAt });
		await starter.claimStarterEmail({
			userId: USER,
			message: STARTER_MESSAGE,
			at: sentAt,
			minGapMs: 0,
			itemCount: 10,
		});
		const afterClaim = await starter.markStarterEmailSent({ userId: USER, at: sentAt });
		const reviewAfterSend = await starter.markStarterEmailReview({
			userId: USER,
			reason: "provider rejected the send",
		});

		expect([beforeClaim, afterClaim, reviewAfterSend]).toEqual([false, true, false]);
		expect(await starter.findStarterPack(USER)).toMatchObject({
			emailStatus: "sent",
			sentAt: sentAt.toISOString(),
		});
	});

	it("holds an email that is being sent for review", async () => {
		const starter = await starterAssigned("treatment");
		await starter.claimStarterEmail({
			userId: USER,
			message: STARTER_MESSAGE,
			at: daysAfterAssignment(0),
			minGapMs: 0,
			itemCount: 10,
		});

		const held = await starter.markStarterEmailReview({
			userId: USER,
			reason: "ambiguous provider response",
		});

		expect(held).toBe(true);
		expect(await starter.findStarterPack(USER)).toMatchObject({
			emailStatus: "review",
			reason: "ambiguous provider response",
		});
	});

	it("withdraws a deleted account's assignment into one anonymous outcome without its message or picks", async () => {
		const starter = await starterAssigned("treatment");
		await starter.claimStarterEmail({
			userId: USER,
			message: STARTER_MESSAGE,
			at: ASSIGNED_AT,
			minGapMs: 0,
			itemCount: 1,
		});

		await starter.withdrawStarterAssignment(USER);
		await starter.withdrawStarterAssignment(USER);

		const outcomes = await starter.listStarterObservations("hn-starter-v1");
		expect(outcomes).toHaveLength(1);
		expect(outcomes[0]?.userId).not.toBe(USER);
		expect(outcomes[0]?.engagement).toEqual({
			activityRevision: 0,
			assignment: assignment("treatment"),
		});
		expect(outcomes[0]?.starterPack).toEqual({
			...PENDING_PACK,
			picks: [],
			emailStatus: "sending",
			firstAttemptAt: ASSIGNED_AT.toISOString(),
			itemCount: 1,
		});
		expect(await starter.findEngagement(USER)).toEqual({ activityRevision: 0 });
	});

	it("withdraws a comparison account without inventing a pack", async () => {
		const starter = await starterAssigned("comparison");

		await starter.withdrawStarterAssignment(USER);

		const outcomes = await starter.listStarterObservations("hn-starter-v1");
		expect(outcomes.map((outcome) => outcome.starterPack)).toEqual([undefined]);
	});

	it("forgets an account's engagement and starter pack when the account is deleted", async () => {
		const starter = await starterAssigned("treatment");

		starter.deleteEngagement(USER);

		expect(await starter.findEngagement(USER)).toEqual({ activityRevision: 0 });
		expect(await starter.findStarterPack(USER)).toBeUndefined();
		expect(await starter.listStarterObservations("hn-starter-v1")).toEqual([]);
	});
});
