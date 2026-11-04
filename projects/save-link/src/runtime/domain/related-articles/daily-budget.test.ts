import assert from "node:assert/strict";
import { type CreateAiMessage, DEEPSEEK_SPECIAL_TOKENS } from "@packages/ai-message";
import { articleDestinationUrl, ReaderArticleHashId } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { type HutchLogger, noopLogger } from "@packages/hutch-logger";
import type { RelatedCandidate } from "@packages/provider-contracts/related-articles";
import { initSelectAgreedPicks } from "./agreed-picks";
import { type RecommendationBudgetDeniedLine, initSelectRelatedArticlesWithinDailyBudget } from "./daily-budget";
import type { BudgetReservation, BudgetWindow, RecommendationBudget } from "./recommendation-budget";
import {
	buildRelatedArticlesRequest,
	initSelectRelatedArticles,
	type SelectRelatedArticles,
	type SelectRelatedArticlesParams,
	type SelectRelatedResult,
} from "./related-articles-selector";

const USER_ID = UserIdSchema.parse("user-1");
const TARGET_URL = "https://example.com/queues";
const WINDOW: BudgetWindow = {
	startsAt: new Date("2026-11-04T00:00:00.000Z"),
	resetsAt: new Date("2026-11-05T00:00:00.000Z"),
	startSeconds: 1_793_750_400,
};
const PROMPT_TOKENS = 1000;
const PER_CALL_NANODOLLARS = (PROMPT_TOKENS + 32) * 300 + 1024 * 1200;

function candidate(name: string): RelatedCandidate {
	const url = `https://example.com/${name}`;
	return {
		url,
		destinationUrl: articleDestinationUrl({ url, displayUrl: undefined }),
		title: `Queues ${name}`,
		siteName: "Example",
		description: "Queues decay words",
	};
}

const PARAMS: SelectRelatedArticlesParams = {
	attempt: { userId: USER_ID, trigger: "reader-request", messageId: "message-1", receiveCount: 3 },
	target: {
		destinationUrl: articleDestinationUrl({ url: TARGET_URL, displayUrl: undefined }),
		title: "How queues decay",
		siteName: "Example",
		description: "Queues decay words",
	},
	unreadCandidates: [candidate("a"), candidate("b")],
	readCandidates: [candidate("c")],
};

const EMPTY_READY: SelectRelatedResult = {
	kind: "ready",
	samples: [],
	related: [],
	inputTokens: 0,
	outputTokens: 0,
	droppedNoSharedWord: 0,
	droppedReasonNotAboutPick: 0,
};

type Usage = Awaited<ReturnType<CreateAiMessage>>["usage"];

function reply(input: { text?: string; usage?: Usage } = {}): Awaited<ReturnType<CreateAiMessage>> {
	return {
		content: [{ type: "text", text: input.text ?? JSON.stringify({ related: [] }) }],
		usage: input.usage ?? { input_tokens: 500, output_tokens: 20, cache_hit_input_tokens: 100, cache_miss_input_tokens: 400 },
	};
}

function fakeBudget(decision: "allowed" | "denied" | Error) {
	const reserved: { userId: string; reservations: readonly { id: string; nanodollars: number }[] }[] = [];
	const settled: { reservation: BudgetReservation; actualNanodollars: number }[] = [];
	const released: BudgetReservation[] = [];
	const budget: RecommendationBudget = {
		reserveRecommendationBudget: async (input) => {
			reserved.push(input);
			if (decision instanceof Error) throw decision;
			if (decision === "denied") return { allowed: false, window: WINDOW, consumedNanodollars: 499_000_000 };
			return {
				allowed: true,
				window: WINDOW,
				reservations: input.reservations.map((reservation) => ({
					...reservation,
					userId: input.userId,
					windowStartSeconds: WINDOW.startSeconds,
				})),
			};
		},
		settleRecommendationBudget: async (input) => {
			settled.push(input);
		},
		releaseRecommendationBudget: async ({ reservation }) => {
			released.push(reservation);
		},
	};
	return { budget, reserved, settled, released };
}

function ledgerBudget(limitNanodollars: number) {
	const consumedByUser = new Map<string, number>();
	const takenIds = new Set<string>();
	const budget: RecommendationBudget = {
		reserveRecommendationBudget: async (input) => {
			const consumed = consumedByUser.get(input.userId) ?? 0;
			const total = input.reservations.reduce((sum, reservation) => sum + reservation.nanodollars, 0);
			if (consumed > limitNanodollars - total) return { allowed: false, window: WINDOW, consumedNanodollars: consumed };
			for (const reservation of input.reservations) {
				assert.ok(!takenIds.has(reservation.id), "A recommendation budget reservation id was already taken");
				takenIds.add(reservation.id);
			}
			consumedByUser.set(input.userId, consumed + total);
			return {
				allowed: true,
				window: WINDOW,
				reservations: input.reservations.map((reservation) => ({
					...reservation,
					userId: input.userId,
					windowStartSeconds: WINDOW.startSeconds,
				})),
			};
		},
		settleRecommendationBudget: async () => {},
		releaseRecommendationBudget: async () => {},
	};
	return { budget, takenIds };
}

function recordingLogger() {
	const infos: unknown[][] = [];
	const warns: unknown[][] = [];
	const logger: HutchLogger = {
		info: (...args) => infos.push(args),
		warn: (...args) => warns.push(args),
		error: () => {},
		debug: () => {},
	};
	return { logger, infos, warns };
}

function setup(input: {
	selection?: "nextRead" | "pastReads";
	calls?: 1 | 2;
	decision?: "allowed" | "denied" | Error;
	replies?: Array<Awaited<ReturnType<CreateAiMessage>> | Error>;
	buildSelector?: (createMessage: CreateAiMessage) => SelectRelatedArticles;
	providerCalls?: number;
	budget?: RecommendationBudget;
}) {
	const selection = input.selection ?? "nextRead";
	const fake = fakeBudget(input.decision ?? "allowed");
	const { logger, infos, warns } = recordingLogger();
	const deniedLines: RecommendationBudgetDeniedLine[] = [];
	const counted: string[] = [];
	const sent: Parameters<CreateAiMessage>[0][] = [];
	const replies = [...(input.replies ?? [])];
	const createMessage: CreateAiMessage = async (params) => {
		sent.push(params);
		const next = replies.shift() ?? reply();
		if (next instanceof Error) throw next;
		return next;
	};
	const providerCalls = input.providerCalls ?? 1;
	const buildSelector =
		input.buildSelector ??
		((metered: CreateAiMessage): SelectRelatedArticles => async (params) => {
			for (let call = 0; call < providerCalls; call += 1) {
				await metered(buildRelatedArticlesRequest({ selection, params }));
			}
			return EMPTY_READY;
		});
	const { selectRelatedArticles } = initSelectRelatedArticlesWithinDailyBudget({
		selection,
		calls: input.calls ?? 1,
		createMessage,
		buildSelector,
		budget: input.budget ?? fake.budget,
		countPromptTokens: async (prompt) => {
			counted.push(prompt);
			return PROMPT_TOKENS;
		},
		limitNanodollars: 500_000_000,
		logger,
		budgetDeniedLog: {
			info: () => {},
			error: () => {},
			debug: () => {},
			warn: (line) => deniedLines.push(line),
		},
	});
	return { selectRelatedArticles, ...fake, infos, warns, deniedLines, counted, sent };
}

describe("initSelectRelatedArticlesWithinDailyBudget", () => {
	it("refuses a spent budget without calling the provider and logs one denial line without text or URLs", async () => {
		const run = setup({ calls: 2, decision: "denied" });

		const result = await run.selectRelatedArticles(PARAMS);

		assert.deepEqual(result, { kind: "budget-limited", resetsAt: WINDOW.resetsAt });
		assert.deepEqual(run.sent, []);
		assert.deepEqual(run.deniedLines, [
			{
				event: "recommendation_budget_denied",
				userId: "user-1",
				feature: "next_read",
				trigger: "reader-request",
				articleId: ReaderArticleHashId.from(TARGET_URL).value,
				messageId: "message-1",
				receiveCount: 3,
				windowStartsAt: "2026-11-04T00:00:00.000Z",
				resetsAt: "2026-11-05T00:00:00.000Z",
				limitNanodollars: 500_000_000,
				consumedNanodollars: 499_000_000,
				requestedNanodollars: PER_CALL_NANODOLLARS * 2,
				calls: 2,
				candidateCount: 3,
				promptTokenBound: PROMPT_TOKENS + 32,
				model: "deepseek-flash",
				priceTable: "2026-09-10",
				tokenizerRevision: "60d8d70770c6776ff598c94bb586a859a38244f1",
			},
		]);
		assert.match(run.deniedLines[0].articleId, /^[0-9a-f]{32}$/);
		assert.doesNotMatch(JSON.stringify(run.deniedLines), /https?:\/\//);
	});

	it("reserves every call up front at the prompt bound plus the full output cap", async () => {
		const run = setup({ selection: "pastReads", calls: 1, decision: "denied" });

		await run.selectRelatedArticles(PARAMS);

		assert.deepEqual(run.reserved, [
			{
				userId: USER_ID,
				reservations: [{ id: "message-1:3:user-1:past_reads:1", nanodollars: (1000 + 32) * 300 + 1024 * 1200 }],
			},
		]);
		assert.equal(run.deniedLines[0].feature, "past_reads");
	});

	it("counts the chat-mode prompt of the exact request it reserves for, in JSON mode", async () => {
		const run = setup({ calls: 1, decision: "denied" });

		await run.selectRelatedArticles(PARAMS);

		const request = buildRelatedArticlesRequest({ selection: "nextRead", params: PARAMS });
		const [prompt] = run.counted;
		assert.ok(prompt.startsWith(`${DEEPSEEK_SPECIAL_TOKENS.bos}${request.system}`));
		assert.ok(prompt.includes('{"type": "json_object"}'));
		assert.ok(prompt.includes(`${DEEPSEEK_SPECIAL_TOKENS.user}SAVED ARTICLE`));
		assert.ok(prompt.endsWith(`${DEEPSEEK_SPECIAL_TOKENS.assistant}${DEEPSEEK_SPECIAL_TOKENS.thinkingEnd}`));
	});

	it("settles both Next-read calls against the reservations the store handed back", async () => {
		const pickA = reply({ text: JSON.stringify({ related: [{ index: 0, reason: "Queues decay" }] }) });
		const run = setup({
			calls: 2,
			replies: [pickA, pickA],
			buildSelector: (metered) =>
				initSelectAgreedPicks(
					initSelectRelatedArticles({ createMessage: metered, selection: "nextRead", nowMs: () => 0, logger: noopLogger }),
				).selectRelatedArticles,
		});

		const result = await run.selectRelatedArticles(PARAMS);

		assert.equal(result.kind, "ready");
		assert.equal(run.sent.length, 2);
		assert.deepEqual(
			run.settled.map(({ reservation }) => reservation),
			[
				{ id: "message-1:3:user-1:next_read:1", nanodollars: PER_CALL_NANODOLLARS, userId: USER_ID, windowStartSeconds: WINDOW.startSeconds },
				{ id: "message-1:3:user-1:next_read:2", nanodollars: PER_CALL_NANODOLLARS, userId: USER_ID, windowStartSeconds: WINDOW.startSeconds },
			],
		);
		assert.deepEqual(run.released, []);
	});

	it("releases the second reservation when the first call leaves nothing to repeat", async () => {
		const run = setup({ calls: 2, providerCalls: 1 });

		assert.deepEqual(await run.selectRelatedArticles(PARAMS), EMPTY_READY);

		assert.deepEqual(run.settled.map(({ reservation }) => reservation.id), ["message-1:3:user-1:next_read:1"]);
		assert.deepEqual(run.released.map((reservation) => reservation.id), ["message-1:3:user-1:next_read:2"]);
	});

	it("charges cache hits, cache misses and output at the peak nanodollar rates and logs the comparison", async () => {
		const run = setup({
			replies: [reply({ usage: { input_tokens: 300, output_tokens: 50, cache_hit_input_tokens: 100, cache_miss_input_tokens: 200 } })],
		});

		await run.selectRelatedArticles(PARAMS);

		assert.equal(run.settled[0].actualNanodollars, 100 * 6 + 200 * 300 + 50 * 1200);
		assert.deepEqual(run.infos, [
			[
				"[related-articles] budget settled",
				{
					reservationId: "message-1:3:user-1:next_read:1",
					promptTokenBound: 1032,
					inputTokens: 300,
					cacheHitInputTokens: 100,
					cacheMissInputTokens: 200,
					outputTokens: 50,
					reservedNanodollars: PER_CALL_NANODOLLARS,
					actualNanodollars: 120_600,
				},
			],
		]);
		assert.deepEqual(run.warns, []);
	});

	it("charges every input token as a cache miss when the provider reports no cache split", async () => {
		const run = setup({ replies: [reply({ usage: { input_tokens: 300, output_tokens: 50 } })] });

		await run.selectRelatedArticles(PARAMS);

		assert.equal(run.settled[0].actualNanodollars, 300 * 300 + 50 * 1200);
	});

	it("warns when the provider counted more input tokens than the reserved bound", async () => {
		const run = setup({ replies: [reply({ usage: { input_tokens: 1033, output_tokens: 1 } })] });

		await run.selectRelatedArticles(PARAMS);

		assert.deepEqual(run.warns, [
			[
				"[related-articles] prompt token bound exceeded",
				{ reservationId: "message-1:3:user-1:next_read:1", promptTokenBound: 1032, inputTokens: 1033 },
			],
		]);
	});

	it("keeps a failed call's reservation charged and releases the calls that never ran", async () => {
		const run = setup({ calls: 2, providerCalls: 2, replies: [new Error("provider timed out")] });

		await assert.rejects(run.selectRelatedArticles(PARAMS), /provider timed out/);

		assert.deepEqual(run.settled, []);
		assert.deepEqual(run.released.map((reservation) => reservation.id), ["message-1:3:user-1:next_read:2"]);
	});

	it("settles a malformed body before the selector rejects it", async () => {
		const run = setup({
			selection: "pastReads",
			replies: [reply({ text: "not json" })],
			buildSelector: (metered) =>
				initSelectRelatedArticles({ createMessage: metered, selection: "pastReads", nowMs: () => 0, logger: noopLogger })
					.selectRelatedArticles,
		});

		await assert.rejects(run.selectRelatedArticles(PARAMS), SyntaxError);

		assert.deepEqual(run.settled.map(({ reservation }) => reservation.id), ["message-1:3:user-1:past_reads:1"]);
		assert.deepEqual(run.released, []);
	});

	it("refuses a provider call that was not reserved", async () => {
		const run = setup({ calls: 2, providerCalls: 3 });

		await assert.rejects(run.selectRelatedArticles(PARAMS), /every provider call was reserved up front/);

		assert.equal(run.sent.length, 2);
		assert.equal(run.settled.length, 2);
	});

	it("lets a storage failure while reserving fail the attempt before any provider call", async () => {
		const run = setup({ decision: new Error("table unavailable") });

		await assert.rejects(run.selectRelatedArticles(PARAMS), /table unavailable/);

		assert.deepEqual(run.sent, []);
	});

	it("reserves distinct ids for two users reached by one message delivery", async () => {
		const ledger = ledgerBudget(500_000_000);
		const run = setup({ calls: 2, budget: ledger.budget });
		const otherUser = { ...PARAMS, attempt: { ...PARAMS.attempt, userId: UserIdSchema.parse("user-2") } };

		assert.deepEqual(await run.selectRelatedArticles(PARAMS), EMPTY_READY);
		assert.deepEqual(await run.selectRelatedArticles(otherUser), EMPTY_READY);

		assert.deepEqual(
			[...ledger.takenIds],
			["message-1:3:user-1:next_read:1", "message-1:3:user-1:next_read:2", "message-1:3:user-2:next_read:1", "message-1:3:user-2:next_read:2"],
		);
	});

	it("admits only one of two concurrent requests when the headroom fits just one", async () => {
		const ledger = ledgerBudget(PER_CALL_NANODOLLARS * 2);
		const nextRead = setup({ selection: "nextRead", calls: 2, budget: ledger.budget });
		const pastReads = setup({ selection: "pastReads", calls: 1, budget: ledger.budget });

		const results = await Promise.all([nextRead.selectRelatedArticles(PARAMS), pastReads.selectRelatedArticles(PARAMS)]);

		assert.deepEqual(results.map((result) => result.kind).sort(), ["budget-limited", "ready"]);
		const sentByRun = [nextRead, pastReads].map((run, index) => ({ kind: results[index].kind, sent: run.sent.length }));
		assert.deepEqual(
			sentByRun.filter(({ kind }) => kind === "ready").map(({ sent }) => sent),
			[1],
		);
		assert.deepEqual(
			sentByRun.filter(({ kind }) => kind === "budget-limited").map(({ sent }) => sent),
			[0],
		);
	});

	it("reserves fresh ids on redelivery and leaves the failed delivery's spent reservation charged", async () => {
		const run = setup({ replies: [new Error("provider timed out")] });
		const firstDelivery = { ...PARAMS, attempt: { ...PARAMS.attempt, receiveCount: 1 } };
		const redelivery = { ...PARAMS, attempt: { ...PARAMS.attempt, receiveCount: 2 } };

		await assert.rejects(run.selectRelatedArticles(firstDelivery), /provider timed out/);
		assert.deepEqual(await run.selectRelatedArticles(redelivery), EMPTY_READY);

		assert.deepEqual(
			run.reserved.map(({ reservations }) => reservations.map(({ id }) => id)),
			[["message-1:1:user-1:next_read:1"], ["message-1:2:user-1:next_read:1"]],
		);
		assert.deepEqual(run.settled.map(({ reservation }) => reservation.id), ["message-1:2:user-1:next_read:1"]);
		assert.deepEqual(run.released, []);
	});
});
