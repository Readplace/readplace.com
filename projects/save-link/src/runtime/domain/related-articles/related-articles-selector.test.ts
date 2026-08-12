import type { CreateAiMessage } from "@packages/ai-message";
import { noopLogger } from "@packages/hutch-logger";
import type { RelatedCandidate } from "@packages/provider-contracts/related-articles";
import {
	RELATED_REASON_MAX_CHARS,
	RELATED_RESULTS_MAX,
} from "./related-articles-limits";
import { initSelectRelatedArticles } from "./related-articles-selector";

const target = {
	title: "How queues decay",
	siteName: "Example",
	description: "What happens to a reading list nobody prunes.",
};

function candidates(count: number): RelatedCandidate[] {
	return Array.from({ length: count }, (_unused, index) => ({
		url: `https://example.com/earlier-${index}`,
		title: `Earlier ${index}`,
		siteName: "Example",
		description: `Summary ${index}`,
	}));
}

interface Captured {
	prompts: string[];
	systems: string[];
}

function selectorReturning(text: string, captured: Captured = { prompts: [], systems: [] }) {
	const createMessage: CreateAiMessage = async (params) => {
		captured.systems.push(params.system);
		for (const message of params.messages) {
			if (typeof message.content === "string") continue;
			for (const block of message.content) {
				if (block.source.type === "text") captured.prompts.push(block.source.data);
			}
		}
		return {
			content: [{ type: "text", text }],
			usage: { input_tokens: 140, output_tokens: 25 },
		};
	};
	const { selectRelatedArticles } = initSelectRelatedArticles({
		createMessage,
		logger: noopLogger,
	});
	return { selectRelatedArticles, captured };
}

describe("initSelectRelatedArticles", () => {
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
			JSON.stringify({ related: [{ index: 2, reason: "Same craft" }] }),
		);

		const result = await selectRelatedArticles({
			target,
			unreadCandidates: candidates(2),
			readCandidates: [
				{
					url: "https://example.com/finished-0",
					title: "Finished 0",
					siteName: "Example",
					description: "Summary finished",
				},
			],
		});

		expect(result).toEqual({
			kind: "ready",
			related: [{ url: "https://example.com/finished-0", reason: "Same craft" }],
			inputTokens: 140,
			outputTokens: 25,
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
					{ index: 2, reason: "Follow-up" },
					{ index: 0, reason: "Same argument" },
				],
			}),
		);

		const result = await selectRelatedArticles({
			target,
			unreadCandidates: candidates(5),
			readCandidates: [],
		});

		expect(result).toEqual({
			kind: "ready",
			related: [
				{ url: "https://example.com/earlier-2", reason: "Follow-up" },
				{ url: "https://example.com/earlier-0", reason: "Same argument" },
			],
			inputTokens: 140,
			outputTokens: 25,
		});
	});

	it("drops a position the model invented outside the candidate list", async () => {
		const { selectRelatedArticles } = selectorReturning(
			JSON.stringify({
				related: [
					{ index: 99, reason: "Hallucinated" },
					{ index: -1, reason: "Also hallucinated" },
					{ index: 1, reason: "Real" },
				],
			}),
		);

		const result = await selectRelatedArticles({
			target,
			unreadCandidates: candidates(3),
			readCandidates: [],
		});

		expect(result).toEqual({
			kind: "ready",
			related: [{ url: "https://example.com/earlier-1", reason: "Real" }],
			inputTokens: 140,
			outputTokens: 25,
		});
	});

	it("keeps only the first mention of a repeated position", async () => {
		const { selectRelatedArticles } = selectorReturning(
			JSON.stringify({
				related: [
					{ index: 1, reason: "First reason" },
					{ index: 1, reason: "Second reason" },
				],
			}),
		);

		const result = await selectRelatedArticles({
			target,
			unreadCandidates: candidates(3),
			readCandidates: [],
		});

		expect(result).toEqual({
			kind: "ready",
			related: [{ url: "https://example.com/earlier-1", reason: "First reason" }],
			inputTokens: 140,
			outputTokens: 25,
		});
	});

	it("caps how many relations one article can carry", async () => {
		const overLimit = Array.from({ length: RELATED_RESULTS_MAX + 2 }, (_unused, index) => ({
			index,
			reason: `Reason ${index}`,
		}));
		const { selectRelatedArticles } = selectorReturning(
			JSON.stringify({ related: overLimit }),
		);

		const result = await selectRelatedArticles({
			target,
			unreadCandidates: candidates(RELATED_RESULTS_MAX + 5),
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
			unreadCandidates: candidates(1),
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
			unreadCandidates: candidates(1),
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
			usage: { input_tokens: 1, output_tokens: 0 },
		});
		const { selectRelatedArticles } = initSelectRelatedArticles({
			createMessage,
			logger: noopLogger,
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
