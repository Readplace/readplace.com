import { articleDestinationUrl } from "@packages/domain/article";
import type { CreateAiMessage } from "@packages/ai-message";
import { noopLogger } from "@packages/hutch-logger";
import type { RelatedCandidate } from "@packages/provider-contracts/related-articles";
import {
	RELATED_REASON_MAX_CHARS,
	RELATED_RESULTS_MAX,
} from "./related-articles-limits";
import { initSelectRelatedArticles } from "./related-articles-selector";

const target = {
	destinationUrl: articleDestinationUrl({ url: "https://example.com/target", displayUrl: undefined }),
	title: "How queues decay",
	siteName: "Example",
	description: "What happens to a reading list nobody prunes.",
};

function candidates(count: number): RelatedCandidate[] {
	return Array.from({ length: count }, (_unused, index) => ({
		destinationUrl: articleDestinationUrl({ url: `https://example.com/earlier-${index}`, displayUrl: undefined }),
		url: `https://example.com/earlier-${index}`,
		title: `Earlier ${index}`,
		siteName: "Example",
		description: `Summary ${index}`,
	}));
}

function groundedCandidates(count: number): RelatedCandidate[] {
	return candidates(count).map((candidate) => ({
		...candidate,
		title: `${candidate.title} queues`,
		description: "Queues decay words xxxxxx",
	}));
}

interface Captured {
	prompts: string[];
	systems: string[];
	features: string[];
}

function selectorReturning(text: string, captured: Captured = { prompts: [], systems: [], features: [] }) {
	const createMessage: CreateAiMessage = async (params) => {
		captured.systems.push(params.system);
		captured.features.push(params.feature);
		for (const message of params.messages) {
			if (typeof message.content === "string") continue;
			for (const block of message.content) {
				if (block.source.type === "text") captured.prompts.push(block.source.data);
			}
		}
		return {
			content: [{ type: "text", text }],
			usage: { input_tokens: 140, output_tokens: 25, cache_hit_input_tokens: 96, cache_miss_input_tokens: 44 },
		};
	};
	const { selectRelatedArticles } = initSelectRelatedArticles({
		nowMs: () => 100,
		createMessage,
		selection: "nextRead",
		logger: noopLogger,
	});
	return { selectRelatedArticles, captured };
}

describe("initSelectRelatedArticles", () => {
	it("counts the two grounding failures separately and never refills beyond the first three valid picks", async () => {
		const { selectRelatedArticles } = selectorReturning(JSON.stringify({ related: [
			{ index: 99, reason: "Invented" },
			{ index: 0, reason: "Invented biology" },
			{ index: 0, reason: "Repeated" },
			{ index: 1, reason: "Astronomy" },
			{ index: 2, reason: "Queue maintenance" },
			{ index: 3, reason: "Queue maintenance" },
		] }));
		const result = await selectRelatedArticles({
			target,
			unreadCandidates: [
				{ destinationUrl: articleDestinationUrl({ url: "https://example.com/astronomy", displayUrl: undefined }), url: "https://example.com/astronomy", title: "Astronomy", description: "Stellar spectra", siteName: "Example" },
				...groundedCandidates(3),
			],
			readCandidates: [],
		});
		expect(result).toMatchObject({
			kind: "ready",
			samples: [expect.objectContaining({ durationMs: 0 })],
			related: [{ url: "https://example.com/earlier-1", reason: "Queue maintenance" }],
			droppedNoSharedWord: 1,
			droppedReasonNotAboutPick: 1,
		});
	});

	it("drops a pick with an empty reason under the reason check", async () => {
		const { selectRelatedArticles } = selectorReturning(JSON.stringify({ related: [{ index: 0, reason: "" }] }));
		expect(await selectRelatedArticles({ target, unreadCandidates: groundedCandidates(1), readCandidates: [] }))
			.toMatchObject({ kind: "ready", related: [], droppedNoSharedWord: 0, droppedReasonNotAboutPick: 1 });
	});

	it("does not count shared site names or the message labels as content", async () => {
		const { selectRelatedArticles } = selectorReturning(JSON.stringify({ related: [{ index: 0, reason: "Astronomy" }] }));
		expect(await selectRelatedArticles({
			target: { ...target, siteName: "Astronomy" },
			unreadCandidates: [{ destinationUrl: articleDestinationUrl({ url: "https://example.com/astronomy", displayUrl: undefined }), url: "https://example.com/astronomy", title: "Astronomy", description: "Stellar spectra", siteName: "Astronomy" }],
			readCandidates: [],
		})).toMatchObject({ kind: "ready", related: [], droppedNoSharedWord: 1, droppedReasonNotAboutPick: 0 });
	});

	it("grounds only the separately clipped title, description and stored reason", async () => {
		const { selectRelatedArticles } = selectorReturning(JSON.stringify({ related: [{ index: 0, reason: `${"Astronomy ".repeat(20)}queues` }] }));
		expect(await selectRelatedArticles({ target, unreadCandidates: groundedCandidates(1), readCandidates: [] }))
			.toMatchObject({ kind: "ready", related: [], droppedNoSharedWord: 0, droppedReasonNotAboutPick: 1 });
		const { selectRelatedArticles: clipped } = selectorReturning(JSON.stringify({ related: [{ index: 0, reason: "Queues" }] }));
		expect(await clipped({
			target,
			unreadCandidates: [{ destinationUrl: articleDestinationUrl({ url: "https://example.com/astronomy", displayUrl: undefined }), url: "https://example.com/astronomy", title: `${"Astronomy ".repeat(40)}queues`, description: `${"Stars ".repeat(60)}queues`, siteName: "Example" }],
			readCandidates: [],
		})).toMatchObject({ kind: "ready", related: [], droppedNoSharedWord: 1, droppedReasonNotAboutPick: 0 });
	});
	it("numbers each candidate so the model answers with positions rather than urls", async () => {
		const { selectRelatedArticles, captured } = selectorReturning(
			JSON.stringify({ related: [] }),
		);

		await selectRelatedArticles({
			target,
			unreadCandidates: candidates(2),
			readCandidates: [],
		});

		const prompt = captured.prompts[0] ?? "";
		expect(prompt).toContain("SAVED ARTICLE");
		expect(prompt).toContain("Title: How queues decay");
		expect(prompt).toContain("[0]\nTitle: Earlier 0");
		expect(prompt).toContain("[1]\nTitle: Earlier 1");
		expect(prompt).not.toContain("https://example.com/earlier-0");
	});

	it("sends the past-reads prompt and the past_reads feature for the pastReads selection", async () => {
		const captured: Captured = { prompts: [], systems: [], features: [] };
		const createMessage: CreateAiMessage = async (params) => {
			captured.systems.push(params.system);
			captured.features.push(params.feature);
			return {
				content: [{ type: "text", text: JSON.stringify({ related: [] }) }],
				usage: { input_tokens: 1, output_tokens: 1 },
			};
		};
		const { selectRelatedArticles } = initSelectRelatedArticles({
		nowMs: () => 100,
			createMessage,
			logger: noopLogger,
			selection: "pastReads",
		});

		await selectRelatedArticles({
			target,
			unreadCandidates: [],
			readCandidates: candidates(1),
		});

		expect(captured.systems[0]).toContain("Pick at most 3 past reads");
		expect(captured.features).toEqual(["past_reads"]);
	});

	it("sends the next_read feature with the Next-read prompt for the nextRead selection", async () => {
		const { selectRelatedArticles, captured } = selectorReturning(JSON.stringify({ related: [] }));

		await selectRelatedArticles({
			target,
			unreadCandidates: candidates(1),
			readCandidates: [],
		});

		expect(captured.features).toEqual(["next_read"]);
		expect(captured.systems[0]).toContain("List every related unread candidate before any past read.");
	});

	it("repeats the saved article after the candidates so a long list cannot bury it", async () => {
		const { selectRelatedArticles, captured } = selectorReturning(
			JSON.stringify({ related: [] }),
		);

		await selectRelatedArticles({
			target,
			unreadCandidates: candidates(2),
			readCandidates: [],
		});

		const prompt = captured.prompts[0] ?? "";
		const echoAt = prompt.lastIndexOf("SAVED ARTICLE (again)");
		expect(echoAt).toBeGreaterThan(prompt.indexOf("[1]\nTitle: Earlier 1"));
		expect(prompt.slice(echoAt)).toContain("Title: How queues decay");
	});

	it("labels the two pools and numbers them as one continuous list", async () => {
		const { selectRelatedArticles, captured } = selectorReturning(
			JSON.stringify({ related: [] }),
		);

		await selectRelatedArticles({
			target,
			unreadCandidates: candidates(2),
			readCandidates: [
				{
					destinationUrl: articleDestinationUrl({ url: "https://example.com/finished-0", displayUrl: undefined }),
					url: "https://example.com/finished-0",
					title: "Finished 0",
					siteName: "Example",
					description: "Summary finished",
				},
			],
		});

		const prompt = captured.prompts[0] ?? "";
		expect(prompt).toContain("UNREAD CANDIDATES\n[0]\nTitle: Earlier 0");
		expect(prompt).toContain("[1]\nTitle: Earlier 1");
		expect(prompt).toContain("PAST READS\n[2]\nTitle: Finished 0");
	});

	it("leaves out the past-reads heading for a reader who has finished nothing else", async () => {
		const { selectRelatedArticles, captured } = selectorReturning(
			JSON.stringify({ related: [] }),
		);

		await selectRelatedArticles({
			target,
			unreadCandidates: candidates(1),
			readCandidates: [],
		});

		const prompt = captured.prompts[0] ?? "";
		expect(prompt.split("\n").filter((line) => line.endsWith("CANDIDATES") || line === "PAST READS")).toEqual([
			"UNREAD CANDIDATES",
		]);
	});

	it("leaves out the unread heading for a reader with nothing left unread", async () => {
		const { selectRelatedArticles, captured } = selectorReturning(
			JSON.stringify({ related: [] }),
		);

		await selectRelatedArticles({
			target,
			unreadCandidates: [],
			readCandidates: candidates(2),
		});

		const prompt = captured.prompts[0] ?? "";
		expect(prompt.split("\n").filter((line) => line.endsWith("CANDIDATES") || line === "PAST READS")).toEqual([
			"PAST READS",
		]);
		expect(prompt).toContain("PAST READS\n[0]\nTitle: Earlier 0");
	});

	it("resolves a position past the unread pool back to the past read it numbered", async () => {
		const { selectRelatedArticles } = selectorReturning(
			JSON.stringify({ related: [{ index: 2, reason: "Queues craft" }] }),
		);

		const result = await selectRelatedArticles({
			target,
			unreadCandidates: groundedCandidates(2),
			readCandidates: [
				{
					destinationUrl: articleDestinationUrl({ url: "https://example.com/finished-0", displayUrl: undefined }),
					url: "https://example.com/finished-0",
					title: "Finished queues 0",
					siteName: "Example",
					description: "Queues decay",
				},
			],
		});

		expect(result).toEqual({
			kind: "ready",
			samples: [expect.objectContaining({ durationMs: 0 })],
			droppedNoSharedWord: 0,
			droppedReasonNotAboutPick: 0,
			related: [{ url: "https://example.com/finished-0", reason: "Queues craft" }],
			inputTokens: 140,
			outputTokens: 25,
			cacheHitInputTokens: 96,
			cacheMissInputTokens: 44,
		});
	});

	it("tells the model to spend every slot it can on the unread pile", async () => {
		const { selectRelatedArticles, captured } = selectorReturning(
			JSON.stringify({ related: [] }),
		);

		await selectRelatedArticles({
			target,
			unreadCandidates: candidates(1),
			readCandidates: [],
		});

		expect(captured.systems[0]).toContain(
			"List every related unread candidate before any past read.",
		);
	});

	it("describes each candidate by the description the store chose", async () => {
		const { selectRelatedArticles, captured } = selectorReturning(
			JSON.stringify({ related: [] }),
		);

		await selectRelatedArticles({
			target,
			unreadCandidates: candidates(1),
			readCandidates: [],
		});

		const prompt = captured.prompts[0] ?? "";
		expect(prompt).toContain("About: Summary 0");
	});

	it("resolves the chosen positions back to their urls and reports token use", async () => {
		const { selectRelatedArticles } = selectorReturning(
			JSON.stringify({
				related: [
					{ index: 2, reason: "Queues follow-up" },
					{ index: 0, reason: "Queues argument" },
				],
			}),
		);

		const result = await selectRelatedArticles({
			target,
			unreadCandidates: groundedCandidates(5),
			readCandidates: [],
		});

		expect(result).toEqual({
			kind: "ready",
			samples: [expect.objectContaining({ durationMs: 0 })],
			droppedNoSharedWord: 0,
			droppedReasonNotAboutPick: 0,
			related: [
				{ url: "https://example.com/earlier-2", reason: "Queues follow-up" },
				{ url: "https://example.com/earlier-0", reason: "Queues argument" },
			],
			inputTokens: 140,
			outputTokens: 25,
			cacheHitInputTokens: 96,
			cacheMissInputTokens: 44,
		});
	});

	it("drops a position the model invented outside the candidate list", async () => {
		const { selectRelatedArticles } = selectorReturning(
			JSON.stringify({
				related: [
					{ index: 99, reason: "Hallucinated" },
					{ index: -1, reason: "Also hallucinated" },
					{ index: 1, reason: "Real queues" },
				],
			}),
		);

		const result = await selectRelatedArticles({
			target,
			unreadCandidates: groundedCandidates(3),
			readCandidates: [],
		});

		expect(result).toEqual({
			kind: "ready",
			samples: [expect.objectContaining({ durationMs: 0 })],
			droppedNoSharedWord: 0,
			droppedReasonNotAboutPick: 0,
			related: [{ url: "https://example.com/earlier-1", reason: "Real queues" }],
			inputTokens: 140,
			outputTokens: 25,
			cacheHitInputTokens: 96,
			cacheMissInputTokens: 44,
		});
	});

	it("keeps only the first mention of a repeated position", async () => {
		const { selectRelatedArticles } = selectorReturning(
			JSON.stringify({
				related: [
					{ index: 1, reason: "First queues reason" },
					{ index: 1, reason: "Second queues reason" },
				],
			}),
		);

		const result = await selectRelatedArticles({
			target,
			unreadCandidates: groundedCandidates(3),
			readCandidates: [],
		});

		expect(result).toEqual({
			kind: "ready",
			samples: [expect.objectContaining({ durationMs: 0 })],
			droppedNoSharedWord: 0,
			droppedReasonNotAboutPick: 0,
			related: [{ url: "https://example.com/earlier-1", reason: "First queues reason" }],
			inputTokens: 140,
			outputTokens: 25,
			cacheHitInputTokens: 96,
			cacheMissInputTokens: 44,
		});
	});

	it("caps how many relations one article can carry", async () => {
		const overLimit = Array.from({ length: RELATED_RESULTS_MAX + 2 }, (_unused, index) => ({
			index,
			reason: `Queues reason ${index}`,
		}));
		const { selectRelatedArticles } = selectorReturning(
			JSON.stringify({ related: overLimit }),
		);

		const result = await selectRelatedArticles({
			target,
			unreadCandidates: groundedCandidates(RELATED_RESULTS_MAX + 5),
			readCandidates: [],
		});

		expect(result.kind === "ready" && result.related).toHaveLength(RELATED_RESULTS_MAX);
	});

	it("clips an overlong reason on a word boundary", async () => {
		const longReason = "words ".repeat(60).trim();
		const { selectRelatedArticles } = selectorReturning(
			JSON.stringify({ related: [{ index: 0, reason: longReason }] }),
		);

		const result = await selectRelatedArticles({
			target,
			unreadCandidates: groundedCandidates(1),
			readCandidates: [],
		});

		expect(result.kind === "ready" && result.related[0]?.reason).toBe(
			`${"words ".repeat(19).trim()}…`,
		);
		expect(
			(result.kind === "ready" && result.related[0]?.reason.length) || 0,
		).toBeLessThanOrEqual(RELATED_REASON_MAX_CHARS);
	});

	it("clips an overlong reason that has no word boundary to fall back on", async () => {
		const unbroken = "x".repeat(RELATED_REASON_MAX_CHARS + 40);
		const { selectRelatedArticles } = selectorReturning(
			JSON.stringify({ related: [{ index: 0, reason: unbroken }] }),
		);

		const result = await selectRelatedArticles({
			target,
			unreadCandidates: groundedCandidates(1),
			readCandidates: [],
		});

		expect(result.kind === "ready" && result.related[0]?.reason).toBe(
			`${"x".repeat(RELATED_REASON_MAX_CHARS - 1)}…`,
		);
	});

	it("reports an unreadable answer so the caller can retry", async () => {
		const { selectRelatedArticles } = selectorReturning("");

		expect(await selectRelatedArticles({
			target,
			unreadCandidates: candidates(3),
			readCandidates: [],
		})).toEqual({
			kind: "no-text-block",
		});
	});

	it("reports an answer that carried no text block at all", async () => {
		const createMessage: CreateAiMessage = async () => ({
			content: [],
			usage: { input_tokens: 1, output_tokens: 0, cache_hit_input_tokens: 0, cache_miss_input_tokens: 1 },
		});
		const { selectRelatedArticles } = initSelectRelatedArticles({
		nowMs: () => 100,
			createMessage,
			logger: noopLogger,
			selection: "nextRead",
		});

		expect(await selectRelatedArticles({
			target,
			unreadCandidates: candidates(3),
			readCandidates: [],
		})).toEqual({
			kind: "no-text-block",
		});
	});

	it("tells the model that the candidate text is untrusted", async () => {
		const { selectRelatedArticles, captured } = selectorReturning(
			JSON.stringify({ related: [] }),
		);

		await selectRelatedArticles({
			target,
			unreadCandidates: candidates(1),
			readCandidates: [],
		});

		expect(captured.systems[0]).toContain("untrusted");
	});
});
