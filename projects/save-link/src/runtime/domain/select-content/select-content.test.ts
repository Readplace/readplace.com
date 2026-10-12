import { CandidateIdSchema } from "@packages/domain/article";
import { noopLogger } from "@packages/hutch-logger";
import { createHash } from "node:crypto";
import { initSelectMostCompleteContent, type CreateSelectorChatCompletion } from "./select-content";

const cid = (id: string) => CandidateIdSchema.parse(id);

const candidates = [
	{ id: cid("extension"), tier: "tier-0" as const, title: "Article", wordCount: 100, html: "<p>Extension article</p>" },
	{ id: cid("live"), tier: "tier-1" as const, title: "Article", wordCount: 100, html: "<p>Live article</p>" },
	{ id: cid("archive"), tier: "tier-2" as const, title: "Challenge", wordCount: 20, html: "<p>Verify you are human</p>", httpStatus: 403 },
];
const request = { url: "https://example.com/article", candidates };

type JudgeAnswer =
	| { kind: "winner"; candidate: string; reason: string }
	| { kind: "tie"; candidates: string[]; reason: string }
	| { kind: "none"; reason: string };

function modelResponse(answer: JudgeAnswer, readableLabels: readonly string[] = [], assessedLabels: readonly string[] = ["A", "B", "C"]): string {
	return JSON.stringify({ ...answer, readability: assessedLabels.map((candidate) => ({ candidate, readable: readableLabels.includes(candidate) })) });
}

function fakeChat(content: string | null | undefined): CreateSelectorChatCompletion {
	return async () => ({
		choices: [{ message: { content } }],
		usage: { prompt_tokens: 900, completion_tokens: 40, prompt_cache_hit_tokens: 768, prompt_cache_miss_tokens: 132 },
	});
}

function judge(content: string | null | undefined) {
	return initSelectMostCompleteContent({ createChatCompletion: fakeChat(content), logger: noopLogger }).selectMostCompleteContent;
}

describe("initSelectMostCompleteContent", () => {
	it("keeps readability of a shorter archive article independent from the live winner", async () => {
		const result = await judge(modelResponse({ kind: "winner", candidate: "B", reason: "Live has an additional article section" }, ["A", "B", "C"]))(request);
		expect(result).toMatchObject({ kind: "winner", candidateId: cid("live"), readability: [{ candidateId: cid("extension"), readable: true }, { candidateId: cid("live"), readable: true }, { candidateId: cid("archive"), readable: true }] });
	});
	it.each([
		undefined,
		[],
		[{ candidate: "B", readable: true }],
		[{ candidate: "A", readable: true }, { candidate: "B", readable: true }, { candidate: "Z", readable: false }],
		[{ candidate: "B", readable: true }, { candidate: "B", readable: true }, { candidate: "C", readable: false }],
		[{ candidate: "A", readable: true }, { candidate: "B", readable: true }, { candidate: "C", readable: false }, { candidate: "Z", readable: false }],
	])("rejects incomplete or fabricated per-candidate readability: %j", async (readability) => {
		await expect(judge(JSON.stringify({ kind: "winner", candidate: "B", reason: "Article", readability }))(request)).rejects.toThrow(/incomplete candidate readability|schema mismatch/);
	});
	it.each([
		modelResponse({ kind: "winner", candidate: "C", reason: "Conflicting assessment" }, ["B"]),
		modelResponse({ kind: "tie", candidates: ["B", "C"], reason: "Conflicting assessment" }, ["B"]),
		modelResponse({ kind: "none", reason: "Conflicting assessment" }, ["B"]),
	])("rejects a ranking that contradicts its readability assessments", async (response) => {
		await expect(judge(response)(request)).rejects.toThrow("decision contradicts candidate readability");
	});
	it.each<{ answer: JudgeAnswer; decision: object }>([
		{ answer: { kind: "winner", candidate: "B", reason: "Most complete" }, decision: { kind: "winner", candidateId: cid("live"), reason: "Most complete" } },
		{ answer: { kind: "tie", candidates: ["A", "B"], reason: "Same article" }, decision: { kind: "tie", candidateIds: [cid("extension"), cid("live")], reason: "Same article" } },
		{ answer: { kind: "none", reason: "Only challenge pages" }, decision: { kind: "none", reason: "Only challenge pages" } },
	])("maps the judge's candidate labels back to candidate ids: $answer", async ({ answer, decision }) => {
		expect(await judge(modelResponse(answer, answer.kind === "none" ? [] : ["A", "B"]))(request)).toMatchObject(decision);
	});

	it("accepts a label the judge wrote in lower case or padded with spaces", async () => {
		const response = JSON.stringify({ kind: "tie", candidates: ["a", " b "], reason: "Same article", readability: [{ candidate: "a", readable: true }, { candidate: "b", readable: true }, { candidate: "c", readable: false }] });
		expect(await judge(response)(request)).toMatchObject({ kind: "tie", candidateIds: [cid("extension"), cid("live")], readability: [{ candidateId: cid("extension"), readable: true }, { candidateId: cid("live"), readable: true }, { candidateId: cid("archive"), readable: false }] });
	});

	it("still judges a single candidate, which can be unreadable", async () => {
		const createChatCompletion = jest.fn(fakeChat(modelResponse({ kind: "none", reason: "CAPTCHA" }, [], ["A"])));
		const { selectMostCompleteContent } = initSelectMostCompleteContent({ createChatCompletion, logger: noopLogger });
		expect(await selectMostCompleteContent({ ...request, candidates: [candidates[2]] })).toMatchObject({ kind: "none", reason: "CAPTCHA" });
		expect(createChatCompletion).toHaveBeenCalledTimes(1);
	});

	it("sends candidate labels and content hashes, never candidate ids, with the actual challenge body in non-thinking JSON mode", async () => {
		const createChatCompletion = jest.fn(fakeChat(modelResponse({ kind: "winner", candidate: "B", reason: "Article" }, ["A", "B"])));
		const info = jest.fn();
		const result = await initSelectMostCompleteContent({ createChatCompletion, logger: { ...noopLogger, info } }).selectMostCompleteContent(request);
		expect(createChatCompletion).toHaveBeenCalledWith(expect.objectContaining({
			model: "deepseek-flash", thinking: { type: "disabled" }, response_format: { type: "json_object" },
			messages: expect.arrayContaining([expect.objectContaining({ role: "user", content: expect.stringContaining("Verify you are human") })]),
		}));
		expect(info).toHaveBeenCalledWith("[SelectContent] completed", {
			url: request.url, inputTokens: 900, outputTokens: 40, cacheHitInputTokens: 768, cacheMissInputTokens: 132,
		});
		const actualMessages = createChatCompletion.mock.calls[0]?.[0].messages;
		expect(result.audit).toEqual({
			judgedCandidates: candidates.map((candidate) => ({ id: candidate.id, contentHash: createHash("sha256").update(candidate.html).digest("hex") })),
			promptHash: createHash("sha256").update(JSON.stringify(actualMessages)).digest("hex"),
			responseStatus: "completed",
		});
		const [extension, live, archive] = result.audit.judgedCandidates.map((candidate) => candidate.contentHash);
		expect(actualMessages?.[1]?.content.split("\n").filter((line) => line.startsWith("--- candidate "))).toEqual([
			`--- candidate A (contentHash=${extension}, tier=tier-0, HTTP=unknown, title "Article", words 100) ---`,
			`--- candidate B (contentHash=${live}, tier=tier-1, HTTP=unknown, title "Article", words 100) ---`,
			`--- candidate C (contentHash=${archive}, tier=tier-2, HTTP=403, title "Challenge", words 20) ---`,
		]);
	});

	it.each([
		["", "empty response"], [null, "empty response"], [undefined, "empty response"],
		["{not json", "malformed response"], ["{}", "schema mismatch"],
		[modelResponse({ kind: "winner", candidate: "Z", reason: "bad label" }), "unknown winner candidate"],
		[modelResponse({ kind: "tie", candidates: ["B", "Z"], reason: "bad label" }), "invalid tied candidates"],
		[modelResponse({ kind: "tie", candidates: ["B", "B"], reason: "duplicate" }), "invalid tied candidates"],
		[modelResponse({ kind: "tie", candidates: ["B", "b"], reason: "duplicate in another case" }), "invalid tied candidates"],
		[modelResponse({ kind: "tie", candidates: ["B", "9f2c4e7a1d3b5f6a8c0e2d4f6b8a0c1e3d5f7a9b1c2d4e6f8a0b2c4d6e8f0a"], reason: "a 62-character candidate id copied with two characters dropped" }, ["A", "B"]), "invalid tied candidates"],
	])("fails closed for invalid model output %s", async (response, reason) => {
		await expect(judge(response)(request)).rejects.toThrow(reason);
	});

	it.each([{ choices: [] }, { choices: [{}] }])("fails closed when the provider omits response content: %j", async (response) => {
		const { selectMostCompleteContent } = initSelectMostCompleteContent({ createChatCompletion: async () => response, logger: noopLogger });
		await expect(selectMostCompleteContent(request)).rejects.toThrow("empty response");
	});

	it.each([
		{ usage: { prompt_tokens: 900, completion_tokens: 40 }, inputTokens: 900, outputTokens: 40 },
		{ usage: undefined, inputTokens: "unknown", outputTokens: "unknown" },
		{ usage: null, inputTokens: "unknown", outputTokens: "unknown" },
	])("logs available usage without requiring cache details: %j", async ({ usage, inputTokens, outputTokens }) => {
		const info = jest.fn();
		const { selectMostCompleteContent } = initSelectMostCompleteContent({
			createChatCompletion: async () => ({ choices: [{ message: { content: modelResponse({ kind: "winner", candidate: "B", reason: "Article" }, ["A", "B"]) } }], usage }),
			logger: { ...noopLogger, info },
		});
		await selectMostCompleteContent(request);
		expect(info).toHaveBeenCalledWith("[SelectContent] completed", {
			url: request.url, inputTokens, outputTokens, cacheHitInputTokens: "unknown", cacheMissInputTokens: "unknown",
		});
	});

	it("fails closed on a nonretryable provider rejection without recording a billed completion", async () => {
		const rejection = Object.assign(new Error("bad request"), { status: 400 });
		const info = jest.fn();
		const error = jest.fn();
		const { selectMostCompleteContent } = initSelectMostCompleteContent({
			createChatCompletion: async () => { throw rejection; }, logger: { ...noopLogger, info, error },
		});
		expect(await selectMostCompleteContent(request)).toMatchObject({ kind: "none", reason: "provider rejected request", audit: { responseStatus: "rejected", judgedCandidates: expect.arrayContaining([{ id: "archive", contentHash: createHash("sha256").update(candidates[2].html).digest("hex") }]) } });
		expect(info).not.toHaveBeenCalledWith("[SelectContent] completed", expect.anything());
		expect(error).toHaveBeenCalledWith("[SelectContent] provider rejected the request", { url: request.url, error: rejection });
	});

	it("rethrows a transient provider failure so the queue can retry", async () => {
		const failure = Object.assign(new Error("internal error"), { status: 500 });
		const { selectMostCompleteContent } = initSelectMostCompleteContent({ createChatCompletion: async () => { throw failure; }, logger: noopLogger });
		await expect(selectMostCompleteContent(request)).rejects.toBe(failure);
	});
});
