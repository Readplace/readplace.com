import assert from "node:assert/strict";
import type { CreateAiMessage } from "@packages/ai-message";
import { articleDestinationUrl } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { noopLogger } from "@packages/hutch-logger";
import type { RelatedCandidate } from "@packages/provider-contracts/related-articles";
import type { BudgetWindow, RecommendationBudget } from "../domain/related-articles/recommendation-budget";
import type { SelectionAttempt } from "../domain/related-articles/related-articles-selector";
import { PAST_READS_PROMPT } from "../domain/related-articles/related-past-reads-prompt";
import { scoreSharedWords } from "../domain/related-articles/shared-words-score";
import { initRelatedArticlesDepBundle } from "./related-articles";

const attempt: SelectionAttempt = { userId: UserIdSchema.parse("user-1"), trigger: "save", messageId: "message-1", receiveCount: 1 };
const WINDOW: BudgetWindow = {
	startsAt: new Date("2026-11-04T00:00:00.000Z"),
	resetsAt: new Date("2026-11-05T00:00:00.000Z"),
	startSeconds: 1_793_750_400,
};
const target = { destinationUrl: articleDestinationUrl({ url: "https://example.com/target", displayUrl: undefined }), title: "Kubernetes operator reconciliation", description: "Cluster state loops", siteName: "Example" };
const bread: RelatedCandidate[] = Array.from({ length: 30 }, (_, index) => ({
	destinationUrl: articleDestinationUrl({ url: `https://example.com/bread-${index}`, displayUrl: undefined }),
	url: `https://example.com/bread-${index}`,
	title: "Sourdough fermentation",
	description: "Baking bread and hydration",
	siteName: "Example",
}));
const ownCopy: RelatedCandidate = { ...target, url: "https://mirror.example.com/operator", destinationUrl: articleDestinationUrl({ url: "https://mirror.example.com/operator", displayUrl: undefined }) };
const band: RelatedCandidate = { url: "https://example.com/patterns", destinationUrl: articleDestinationUrl({ url: "https://example.com/patterns", displayUrl: undefined }), title: "Kubernetes operator patterns", description: "Writing custom controllers", siteName: "Example" };
const bandPool = [band, ...bread];
const ownCopyPool = [ownCopy, ...bread];
const bandPick = { index: 0, reason: "Kubernetes operator patterns for controllers" };
const ownCopyPick = { index: 0, reason: "Kubernetes operator reconciliation again" };

function bundleAnswering(picks: readonly { index: number; reason: string }[], decision: "allowed" | "denied" = "allowed") {
	const systems: string[] = [];
	const reservedIds: string[][] = [];
	const deniedFeatures: string[] = [];
	const budget: RecommendationBudget = {
		reserveRecommendationBudget: async (input) => {
			reservedIds.push(input.reservations.map((reservation) => reservation.id));
			if (decision === "denied") return { allowed: false, window: WINDOW, consumedNanodollars: 500_000_000 };
			return {
				allowed: true,
				window: WINDOW,
				reservations: input.reservations.map((reservation) => ({ ...reservation, userId: input.userId, windowStartSeconds: WINDOW.startSeconds })),
			};
		},
		settleRecommendationBudget: async () => {},
		releaseRecommendationBudget: async () => {},
	};
	const features: string[] = [];
	const createMessage: CreateAiMessage = async (params) => {
		systems.push(params.system);
		features.push(params.feature);
		return {
			content: [{ type: "text", text: JSON.stringify({ related: picks }) }],
			usage: { input_tokens: 100, output_tokens: 10 },
		};
	};
	const bundle = initRelatedArticlesDepBundle({
		createMessage,
		nowMs: () => 0,
		logger: noopLogger,
		budget,
		countPromptTokens: async () => 1000,
		budgetDeniedLog: {
			info: () => {},
			error: () => {},
			debug: () => {},
			warn: (line) => deniedFeatures.push(line.feature),
		},
	});
	return { ...bundle, systems, features, reservedIds, deniedFeatures };
}

describe("initRelatedArticlesDepBundle", () => {
	it("a best score of at least 7.5 and below 8 reaches the model for Next read but skips Already read", async () => {
		const best = Math.max(...scoreSharedWords({ target, candidates: bandPool }));
		expect(best).toBeGreaterThanOrEqual(7.5);
		expect(best).toBeLessThan(8);

		const nextRead = bundleAnswering([bandPick]);
		const nextReadResult = await nextRead.selectRelatedArticles({ attempt, target, unreadCandidates: bandPool, readCandidates: [] });
		expect(nextReadResult.kind).toBe("ready");

		const pastReads = bundleAnswering([bandPick]);
		expect(await pastReads.selectPastReads({ attempt, target, unreadCandidates: [], readCandidates: bandPool }))
			.toEqual({ kind: "no-shared-words", bestScore: best, candidateCount: 31 });
		expect(pastReads.systems).toHaveLength(0);
	});

	it("a same-titled copy of the target does not lift Next read over its floor, but lifts Already read", async () => {
		const nextRead = bundleAnswering([ownCopyPick]);
		expect(await nextRead.selectRelatedArticles({ attempt, target, unreadCandidates: ownCopyPool, readCandidates: [] }))
			.toEqual({ kind: "no-shared-words", bestScore: 0, candidateCount: 31 });
		expect(nextRead.systems).toHaveLength(0);

		const pastReads = bundleAnswering([ownCopyPick]);
		const pastReadsResult = await pastReads.selectPastReads({ attempt, target, unreadCandidates: [], readCandidates: ownCopyPool });
		expect(pastReadsResult.kind).toBe("ready");
	});

	it("Next read samples twice when the first sample has a pick, and Already read samples once", async () => {
		const nextRead = bundleAnswering([bandPick]);
		const nextReadResult = await nextRead.selectRelatedArticles({ attempt, target, unreadCandidates: bandPool, readCandidates: [] });
		assert(nextReadResult.kind === "ready");
		expect(nextRead.systems).toHaveLength(2);
		expect(nextReadResult.samples).toHaveLength(2);

		const pastReads = bundleAnswering([ownCopyPick]);
		const pastReadsResult = await pastReads.selectPastReads({ attempt, target, unreadCandidates: [], readCandidates: ownCopyPool });
		assert(pastReadsResult.kind === "ready");
		expect(pastReads.systems).toHaveLength(1);
		expect(pastReadsResult.samples).toHaveLength(1);
	});

	it("Already read sends the past-reads prompt, and Next read does not", async () => {
		const nextRead = bundleAnswering([bandPick]);
		await nextRead.selectRelatedArticles({ attempt, target, unreadCandidates: bandPool, readCandidates: [] });
		const pastReads = bundleAnswering([ownCopyPick]);
		await pastReads.selectPastReads({ attempt, target, unreadCandidates: [], readCandidates: ownCopyPool });

		expect(nextRead.systems).toHaveLength(2);
		expect(pastReads.systems).toHaveLength(1);
		for (const system of pastReads.systems) expect(system).toBe(PAST_READS_PROMPT);
		for (const system of nextRead.systems) expect(system).not.toBe(PAST_READS_PROMPT);
	});

	it("Next read names the next_read feature on both samples, and Already read names past_reads", async () => {
		const nextRead = bundleAnswering([bandPick]);
		await nextRead.selectRelatedArticles({ attempt, target, unreadCandidates: bandPool, readCandidates: [] });
		const pastReads = bundleAnswering([ownCopyPick]);
		await pastReads.selectPastReads({ attempt, target, unreadCandidates: [], readCandidates: ownCopyPool });

		expect(nextRead.features).toEqual(["next_read", "next_read"]);
		expect(pastReads.features).toEqual(["past_reads"]);
	});

	it("a shared-boilerplate target skips before the floor in both chains", async () => {
		const block = { destinationUrl: articleDestinationUrl({ url: "https://blocked.example.com", displayUrl: undefined }), title: "Access denied", description: "Please enable cookies", siteName: "Blocked" };
		const mirror: RelatedCandidate = { ...block, url: "https://other.example.com", destinationUrl: articleDestinationUrl({ url: "https://other.example.com", displayUrl: undefined }), siteName: "Other" };
		const pool = [mirror, ...bread];
		const bundle = bundleAnswering([{ index: 0, reason: "Access denied again" }]);

		expect(await bundle.selectRelatedArticles({ attempt, target: block, unreadCandidates: pool, readCandidates: [] }))
			.toEqual({ kind: "shared-boilerplate" });
		expect(await bundle.selectPastReads({ attempt, target: block, unreadCandidates: [], readCandidates: pool }))
			.toEqual({ kind: "shared-boilerplate" });
		expect(bundle.systems).toHaveLength(0);
	});

	it("a shared-boilerplate target and a below-floor set reach no budget reservation in either chain", async () => {
		const block = { destinationUrl: articleDestinationUrl({ url: "https://blocked.example.com", displayUrl: undefined }), title: "Access denied", description: "Please enable cookies", siteName: "Blocked" };
		const mirror: RelatedCandidate = { ...block, url: "https://other.example.com", destinationUrl: articleDestinationUrl({ url: "https://other.example.com", displayUrl: undefined }), siteName: "Other" };
		const bundle = bundleAnswering([bandPick]);

		await bundle.selectRelatedArticles({ attempt, target: block, unreadCandidates: [mirror, ...bread], readCandidates: [] });
		await bundle.selectPastReads({ attempt, target: block, unreadCandidates: [], readCandidates: [mirror, ...bread] });
		await bundle.selectRelatedArticles({ attempt, target, unreadCandidates: bread, readCandidates: [] });
		await bundle.selectPastReads({ attempt, target, unreadCandidates: [], readCandidates: bread });

		expect(bundle.reservedIds).toEqual([]);
	});

	it("a denied reservation ends budget-limited before any provider call in both chains", async () => {
		const bundle = bundleAnswering([bandPick], "denied");

		expect(await bundle.selectRelatedArticles({ attempt, target, unreadCandidates: bandPool, readCandidates: [] }))
			.toEqual({ kind: "budget-limited", resetsAt: WINDOW.resetsAt });
		expect(await bundle.selectPastReads({ attempt, target, unreadCandidates: [], readCandidates: ownCopyPool }))
			.toEqual({ kind: "budget-limited", resetsAt: WINDOW.resetsAt });
		expect(bundle.systems).toEqual([]);
		expect(bundle.deniedFeatures).toEqual(["next_read", "past_reads"]);
	});

	it("Next read reserves two calls and Already read reserves one", async () => {
		const bundle = bundleAnswering([bandPick]);

		await bundle.selectRelatedArticles({ attempt, target, unreadCandidates: bandPool, readCandidates: [] });
		await bundle.selectPastReads({ attempt, target, unreadCandidates: [], readCandidates: ownCopyPool });

		expect(bundle.reservedIds).toEqual([
			["message-1:1:user-1:next_read:1", "message-1:1:user-1:next_read:2"],
			["message-1:1:user-1:past_reads:1"],
		]);
	});
});
