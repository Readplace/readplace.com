import type { CreateAiMessage } from "@packages/ai-message";
import { readlistPurposeVersion } from "@packages/domain/readlist";
import { initDecideReadlistFitWithDeepseek } from "./deepseek-readlist-fit";
import type { ReadlistFitEngine } from "./readlist-fit-engine";
import { READLIST_FIT_PROMPT } from "./readlist-fit-prompt";

type Captured = Parameters<CreateAiMessage>[0];
type Usage = Awaited<ReturnType<CreateAiMessage>>["usage"];

const PURPOSE = {
	keep: "Engineering practice: code review and testing.",
	skip: "Product launches.",
	version: readlistPurposeVersion("Keep articles about: Engineering practice: code review and testing.\nSkip: Product launches."),
};
const CANDIDATES = [
	{ id: "0000", url: "https://a.test/small-prs", text: "Ship small PRs" },
	{ id: "0002", url: "https://b.test/sale", text: "Our spring sale" },
	{ id: "0005", url: "https://c.test/testing", text: "Testing in production" },
];

function answering(
	body: unknown,
	usage: Usage = { input_tokens: 900, output_tokens: 120, reasoning_tokens: 0, cache_hit_input_tokens: 600, cache_miss_input_tokens: 300 },
): { createAiMessage: CreateAiMessage; calls: Captured[] } {
	const calls: Captured[] = [];
	const createAiMessage: CreateAiMessage = async (params) => {
		calls.push(params);
		return { content: [{ type: "text", text: JSON.stringify(body) }], usage };
	};
	return { createAiMessage, calls };
}

function decide(input: { engine?: ReadlistFitEngine; body: unknown; usage?: Usage; candidates?: typeof CANDIDATES; context?: { subject: string; senderEmail: string }; skip?: string }) {
	const { createAiMessage, calls } = answering(input.body, input.usage);
	const decideFit = initDecideReadlistFitWithDeepseek({ createAiMessage, engine: input.engine ?? "deepseek-flash" });
	const result = decideFit({
		purpose: { keep: PURPOSE.keep, skip: input.skip, version: PURPOSE.version },
		examples: [],
		candidates: input.candidates ?? CANDIDATES,
		context: input.context,
	});
	return { result, calls };
}

const ALL_THREE = {
	links: [
		{ id: "0005", verdict: "keep", reason: "Testing practice, which keep asks for." },
		{ id: "0000", verdict: "unsure", reason: "Nothing says it covers code review." },
		{ id: "0002", verdict: "drop", reason: "A sale, which skip excludes." },
	],
};

describe("initDecideReadlistFitWithDeepseek", () => {
	it("returns every verdict in candidate order", async () => {
		const { result } = decide({ body: ALL_THREE });

		expect((await result).decisions).toEqual([
			{ id: "0000", verdict: "unsure", reason: "Nothing says it covers code review." },
			{ id: "0002", verdict: "drop", reason: "A sale, which skip excludes." },
			{ id: "0005", verdict: "keep", reason: "Testing practice, which keep asks for." },
		]);
	});

	it("throws when the model labels an id that is not in the input", async () => {
		const { result } = decide({ body: { links: [...ALL_THREE.links, { id: "0009", verdict: "keep", reason: "r" }] } });

		await expect(result).rejects.toThrow("model labelled id 0009, which is not in the input");
	});

	it("throws when the model labels an id twice", async () => {
		const { result } = decide({ body: { links: [...ALL_THREE.links, ALL_THREE.links[0]] } });

		await expect(result).rejects.toThrow("model labelled id 0005 more than once");
	});

	it("throws when the model leaves an id unlabelled", async () => {
		const { result } = decide({ body: { links: ALL_THREE.links.slice(0, 2) } });

		await expect(result).rejects.toThrow("model left id 0002 unlabelled");
	});

	it("throws when the response has no text block", async () => {
		const createAiMessage: CreateAiMessage = async () => ({
			content: [],
			usage: { input_tokens: 1, output_tokens: 1 },
		});
		const decideFit = initDecideReadlistFitWithDeepseek({ createAiMessage, engine: "deepseek-flash" });

		await expect(
			decideFit({ purpose: PURPOSE, examples: [], candidates: CANDIDATES }),
		).rejects.toThrow("readlist-fit response has no text block");
	});

	it("clips every reason to 120 characters on one line", async () => {
		const long = `${"word ".repeat(40)}\n tail`;
		const { result } = decide({
			body: { links: CANDIDATES.map((candidate) => ({ id: candidate.id, verdict: "unsure", reason: long })) },
		});

		for (const decision of (await result).decisions) {
			expect(decision.reason).toHaveLength(120);
			expect(decision.reason).not.toContain("\n");
		}
	});

	it("cuts each URL to 300 characters in the prompt", async () => {
		const longUrl = `https://a.test/${"x".repeat(400)}`;
		const { result, calls } = decide({
			body: { links: [{ id: "0000", verdict: "keep", reason: "r" }] },
			candidates: [{ id: "0000", url: longUrl, text: "Long" }],
		});
		await result;

		const sent = JSON.parse(String(calls[0]?.messages[0]?.content));
		expect(sent.candidates[0].url).toBe(longUrl.slice(0, 300));
	});

	it("sends the fixed prompt as the system message and the slots, in order, as the user message", async () => {
		const { result, calls } = decide({
			body: ALL_THREE,
			skip: PURPOSE.skip,
			context: { subject: "This week", senderEmail: "news@example.com" },
		});
		await result;

		expect(calls[0]?.system).toBe(READLIST_FIT_PROMPT);
		const content = String(calls[0]?.messages[0]?.content);
		expect(Object.keys(JSON.parse(content))).toEqual(["keep", "skip", "examples", "email", "candidates"]);
		expect(JSON.parse(content).email).toEqual({ subject: "This week", from: "news@example.com" });
		expect(calls[0]?.system).not.toContain(PURPOSE.keep);
	});

	it("leaves skip and email out when they are not given", async () => {
		const { result, calls } = decide({ body: ALL_THREE });
		await result;

		expect(Object.keys(JSON.parse(String(calls[0]?.messages[0]?.content)))).toEqual(["keep", "examples", "candidates"]);
	});

	it.each([
		["deepseek-flash", 8192, "deepseek-flash"],
		["deepseek-v4-pro-thinking", 32768, "deepseek-v4-pro"],
	] as const)("asks %s for at most %i output tokens and names its model", async (engine, maxTokens, model) => {
		const { result, calls } = decide({ engine, body: ALL_THREE });
		const decided = await result;

		expect(calls[0]?.max_tokens).toBe(maxTokens);
		expect(decided.engine).toBe(engine);
		expect(decided.model).toBe(model);
	});

	it("reports usage without adding reasoning to output", async () => {
		const { result } = decide({
			engine: "deepseek-v4-pro-thinking",
			body: ALL_THREE,
			usage: { input_tokens: 900, output_tokens: 4000, reasoning_tokens: 3500, cache_hit_input_tokens: 600, cache_miss_input_tokens: 300 },
		});

		expect((await result).usage).toEqual({
			inputTokens: 900,
			outputTokens: 4000,
			reasoningTokens: 3500,
			cacheHitInputTokens: 600,
			cacheMissInputTokens: 300,
		});
	});

	it("reports no reasoning tokens when the usage omits them", async () => {
		const { result } = decide({ body: ALL_THREE, usage: { input_tokens: 900, output_tokens: 120 } });

		expect((await result).usage).toEqual({ inputTokens: 900, outputTokens: 120, reasoningTokens: 0, cacheHitInputTokens: undefined, cacheMissInputTokens: undefined });
	});
});
