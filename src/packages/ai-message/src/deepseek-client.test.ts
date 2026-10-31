import { initCreateDeepseekMessage, initCreateDeepseekThinkingMessage } from "./create-deepseek-message";
import { initCreateDeepseekChatCompletion } from "./deepseek-chat-completion";
import { type DeepseekClientOptions, initDeepseekClient } from "./deepseek-client";
import { DEEPSEEK_FEATURES } from "./deepseek-feature";
import type { DeepseekUsageLine } from "./deepseek-usage-line.types";

type FakeAnswer = { status: number; body: unknown; headers?: Record<string, string> };
type FetchCall = { url: string; init: RequestInit | undefined };
type LogEntry = { level: string; message: string };

function fakeFetch(answers: FakeAnswer[]) {
	const calls: FetchCall[] = [];
	const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		calls.push({ url: String(input), init });
		const answer = answers[calls.length - 1];
		return new Response(JSON.stringify(answer.body), {
			status: answer.status,
			headers: { "content-type": "application/json", ...answer.headers },
		});
	};
	return { fetch, calls };
}

function hangingFetch() {
	const calls: FetchCall[] = [];
	const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
		new Promise((_resolve, reject) => {
			calls.push({ url: String(input), init });
			init?.signal?.addEventListener("abort", () =>
				reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })),
			);
		});
	return { fetch, calls };
}

function capturingLogger(entries: LogEntry[]) {
	const at = (level: string) => (message: string) => {
		entries.push({ level, message });
	};
	return { error: at("error"), warn: at("warn"), info: at("info"), debug: at("debug") };
}

function door(options: Partial<DeepseekClientOptions> & Pick<DeepseekClientOptions, "fetch">) {
	const lines: DeepseekUsageLine[] = [];
	const client = initDeepseekClient({
		apiKey: "test-key",
		timeoutMs: 60_000,
		maxRetries: 0,
		logger: capturingLogger([]),
		logLevel: "off",
		callTimeoutMs: null,
		logUsage: (line) => {
			lines.push(line);
		},
		now: () => new Date("2026-10-26T02:15:00.000Z"),
		...options,
	});
	return { client, lines };
}

const flashAnswer = (usage?: Record<string, unknown>) => ({
	model: "deepseek-flash",
	choices: [{ message: { content: "{}" } }],
	usage,
});

describe("initDeepseekClient", () => {
	it.each([
		["summary", "summary"],
		["nextRead", "next_read"],
		["pastReads", "past_reads"],
		["readlistPurposeFilter", "readlist_purpose_filter"],
		["newsletterLinkTriage", "newsletter_link_triage"],
		["contentSelection", "content_selection"],
		["pdfExtraction", "pdf_extraction"],
	] as const)("posts the same non-thinking JSON-mode body for %s and labels its usage line %s", async (key, id) => {
		const { fetch, calls } = fakeFetch([{ status: 200, body: flashAnswer({ prompt_tokens: 3, completion_tokens: 1 }) }]);
		const { client, lines } = door({ fetch });

		await initCreateDeepseekChatCompletion({ client })({
			feature: DEEPSEEK_FEATURES[key],
			max_tokens: 1024,
			response_format: { type: "json_object" },
			messages: [
				{ role: "system", content: "You are a summarizer." },
				{ role: "user", content: "Summarize this article" },
			],
		});

		expect(calls.map((call) => call.url)).toEqual(["https://api.deepseek.com/chat/completions"]);
		expect(new Headers(calls[0].init?.headers).get("authorization")).toBe("Bearer test-key");
		expect(calls[0].init?.body).toBe(
			'{"model":"deepseek-flash","thinking":{"type":"disabled"},"max_tokens":1024,"response_format":{"type":"json_object"},"messages":[{"role":"system","content":"You are a summarizer."},{"role":"user","content":"Summarize this article"}]}',
		);
		expect(lines.map((line) => line.feature)).toEqual([id]);
	});

	it("sends temperature and no response_format the way the cleanup and convert adapters ask", async () => {
		const { fetch, calls } = fakeFetch([{ status: 200, body: flashAnswer({ prompt_tokens: 3, completion_tokens: 1 }) }]);
		const { client } = door({ fetch });

		await initCreateDeepseekChatCompletion({ client })({
			feature: DEEPSEEK_FEATURES.pdfExtraction,
			max_tokens: 256,
			temperature: 0,
			messages: [
				{ role: "system", content: "Clean this page." },
				{ role: "user", content: "<p>page</p>" },
			],
		});

		expect(calls[0].init?.body).toBe(
			'{"model":"deepseek-flash","thinking":{"type":"disabled"},"max_tokens":256,"temperature":0,"messages":[{"role":"system","content":"Clean this page."},{"role":"user","content":"<p>page</p>"}]}',
		);
	});

	it("sends temperature before response_format the way the diff-review adapter asks", async () => {
		const { fetch, calls } = fakeFetch([{ status: 200, body: flashAnswer({ prompt_tokens: 3, completion_tokens: 1 }) }]);
		const { client } = door({ fetch });

		await initCreateDeepseekChatCompletion({ client })({
			feature: DEEPSEEK_FEATURES.pdfExtraction,
			max_tokens: 4096,
			temperature: 0,
			response_format: { type: "json_object" },
			messages: [
				{ role: "system", content: "Review this document." },
				{ role: "user", content: "pages" },
			],
		});

		expect(calls[0].init?.body).toBe(
			'{"model":"deepseek-flash","thinking":{"type":"disabled"},"max_tokens":4096,"temperature":0,"response_format":{"type":"json_object"},"messages":[{"role":"system","content":"Review this document."},{"role":"user","content":"pages"}]}',
		);
	});

	it("sends the deepseek-v4-pro thinking body with no temperature", async () => {
		const { fetch, calls } = fakeFetch([
			{ status: 200, body: { model: "deepseek-v4-pro", choices: [{ message: { content: '{"links":[]}' } }], usage: { prompt_tokens: 50, completion_tokens: 20 } } },
		]);
		const { client } = door({ fetch });

		await initCreateDeepseekThinkingMessage({ client })({
			feature: DEEPSEEK_FEATURES.readlistPurposeFilter,
			max_tokens: 32768,
			system: "You are a filter.",
			messages: [{ role: "user", content: "Filter these links" }],
		});

		expect(calls[0].init?.body).toBe(
			'{"model":"deepseek-v4-pro","thinking":{"type":"enabled"},"max_tokens":32768,"response_format":{"type":"json_object"},"messages":[{"role":"system","content":"You are a filter."},{"role":"user","content":"Filter these links"}]}',
		);
	});

	it("prices an answered call at the rate of the instant it was sent", async () => {
		const { fetch } = fakeFetch([
			{ status: 200, body: flashAnswer({ prompt_tokens: 1200, completion_tokens: 300, prompt_cache_hit_tokens: 200, prompt_cache_miss_tokens: 1000 }) },
		]);
		const { client, lines } = door({ fetch });

		await initCreateDeepseekMessage({ client })({
			feature: DEEPSEEK_FEATURES.summary,
			max_tokens: 1024,
			system: "You are a summarizer.",
			messages: [{ role: "user", content: "Summarize this article" }],
		});

		expect(lines.map((line) => JSON.stringify(line))).toEqual([
			'{"stream":"analytics","event":"deepseek_usage","timestamp":"2026-10-26T02:15:00.000Z","feature":"summary","model":"deepseek-flash","served_model":"deepseek-flash","rate":"peak","input_tokens":1200,"cache_hit_input_tokens":200,"cache_miss_input_tokens":1000,"output_tokens":300,"price_table":"2026-09-10","usd":0.0006612}',
		]);
	});

	it("prices deepseek-v4-pro at its off-peak row and carries reasoning tokens without adding them", async () => {
		const { fetch } = fakeFetch([
			{
				status: 200,
				body: {
					model: "deepseek-v4-pro",
					choices: [{ message: { content: '{"links":[]}' } }],
					usage: {
						prompt_tokens: 5000,
						completion_tokens: 2000,
						prompt_cache_hit_tokens: 0,
						prompt_cache_miss_tokens: 5000,
						completion_tokens_details: { reasoning_tokens: 1500 },
					},
				},
			},
		]);
		const { client, lines } = door({ fetch, now: () => new Date("2026-10-31T02:00:00.000Z") });

		await initCreateDeepseekThinkingMessage({ client })({
			feature: DEEPSEEK_FEATURES.readlistPurposeFilter,
			max_tokens: 32768,
			system: "You are a filter.",
			messages: [{ role: "user", content: "Filter these links" }],
		});

		expect(lines.map((line) => JSON.stringify(line))).toEqual([
			'{"stream":"analytics","event":"deepseek_usage","timestamp":"2026-10-31T02:00:00.000Z","feature":"readlist_purpose_filter","model":"deepseek-v4-pro","served_model":"deepseek-v4-pro","rate":"off_peak","input_tokens":5000,"cache_hit_input_tokens":0,"cache_miss_input_tokens":5000,"output_tokens":2000,"reasoning_tokens":1500,"price_table":"2026-09-10","usd":0.00726}',
		]);
	});

	it("logs an unpriced line when the answer carries no usage", async () => {
		const { fetch } = fakeFetch([{ status: 200, body: flashAnswer() }]);
		const { client, lines } = door({ fetch });

		await initCreateDeepseekChatCompletion({ client })({
			feature: DEEPSEEK_FEATURES.contentSelection,
			max_tokens: 8192,
			response_format: { type: "json_object" },
			messages: [{ role: "user", content: "Pick the most complete candidate" }],
		});

		expect(lines.map((line) => JSON.stringify(line))).toEqual([
			'{"stream":"analytics","event":"deepseek_usage","timestamp":"2026-10-26T02:15:00.000Z","feature":"content_selection","model":"deepseek-flash","served_model":"deepseek-flash","rate":"peak"}',
		]);
	});

	it("logs an unpriced line when the usage has no cache split", async () => {
		const { fetch } = fakeFetch([{ status: 200, body: flashAnswer({ prompt_tokens: 10, completion_tokens: 5 }) }]);
		const { client, lines } = door({ fetch });

		await initCreateDeepseekChatCompletion({ client })({
			feature: DEEPSEEK_FEATURES.contentSelection,
			max_tokens: 8192,
			response_format: { type: "json_object" },
			messages: [{ role: "user", content: "Pick the most complete candidate" }],
		});

		expect(lines.map((line) => JSON.stringify(line))).toEqual([
			'{"stream":"analytics","event":"deepseek_usage","timestamp":"2026-10-26T02:15:00.000Z","feature":"content_selection","model":"deepseek-flash","served_model":"deepseek-flash","rate":"peak","input_tokens":10,"output_tokens":5}',
		]);
	});

	it("logs a line without token fields when the usage is malformed", async () => {
		const { fetch } = fakeFetch([{ status: 200, body: flashAnswer({ prompt_tokens: "10", completion_tokens: 5 }) }]);
		const { client, lines } = door({ fetch });

		await initCreateDeepseekChatCompletion({ client })({
			feature: DEEPSEEK_FEATURES.contentSelection,
			max_tokens: 8192,
			response_format: { type: "json_object" },
			messages: [{ role: "user", content: "Pick the most complete candidate" }],
		});

		expect(lines.map((line) => JSON.stringify(line))).toEqual([
			'{"stream":"analytics","event":"deepseek_usage","timestamp":"2026-10-26T02:15:00.000Z","feature":"content_selection","model":"deepseek-flash","served_model":"deepseek-flash","rate":"peak"}',
		]);
	});

	it("lets a 400 reach the caller with its status and logs no line", async () => {
		const { fetch, calls } = fakeFetch([{ status: 400, body: { error: { message: "bad" } } }]);
		const { client, lines } = door({ fetch });

		const answer = initCreateDeepseekChatCompletion({ client })({
			feature: DEEPSEEK_FEATURES.contentSelection,
			max_tokens: 8192,
			messages: [{ role: "user", content: "Pick" }],
		});

		await expect(answer).rejects.toMatchObject({ status: 400 });
		expect(calls).toHaveLength(1);
		expect(lines).toEqual([]);
	});

	it("does not retry a 500 when maxRetries is 0", async () => {
		const { fetch, calls } = fakeFetch([{ status: 500, body: { error: { message: "down" } } }]);
		const { client } = door({ fetch });

		const answer = initCreateDeepseekChatCompletion({ client })({
			feature: DEEPSEEK_FEATURES.contentSelection,
			max_tokens: 8192,
			messages: [{ role: "user", content: "Pick" }],
		});

		await expect(answer).rejects.toMatchObject({ status: 500 });
		expect(calls).toHaveLength(1);
	});

	it("retries a 500 once when maxRetries is 1", async () => {
		const { fetch, calls } = fakeFetch([
			{ status: 500, body: { error: { message: "down" } }, headers: { "retry-after-ms": "1" } },
			{ status: 200, body: flashAnswer({ prompt_tokens: 3, completion_tokens: 1 }) },
		]);
		const { client, lines } = door({ fetch, maxRetries: 1 });

		const answer = await initCreateDeepseekChatCompletion({ client })({
			feature: DEEPSEEK_FEATURES.contentSelection,
			max_tokens: 8192,
			messages: [{ role: "user", content: "Pick" }],
		});

		expect(answer).toEqual(flashAnswer({ prompt_tokens: 3, completion_tokens: 1 }));
		expect(calls).toHaveLength(2);
		expect(lines).toHaveLength(1);
	});

	it("aborts the call after callTimeoutMs and logs no line", async () => {
		const { fetch, calls } = hangingFetch();
		const { client, lines } = door({ fetch, callTimeoutMs: 5 });

		const answer = initCreateDeepseekChatCompletion({ client })({
			feature: DEEPSEEK_FEATURES.contentSelection,
			max_tokens: 8192,
			messages: [{ role: "user", content: "Pick" }],
		});

		await expect(answer).rejects.toThrow("Request was aborted.");
		expect(calls).toHaveLength(1);
		expect(lines).toEqual([]);
	});

	it("times out through the SDK after timeoutMs when callTimeoutMs is unset", async () => {
		const { fetch, calls } = hangingFetch();
		const { client, lines } = door({ fetch, timeoutMs: 10 });

		const answer = initCreateDeepseekChatCompletion({ client })({
			feature: DEEPSEEK_FEATURES.contentSelection,
			max_tokens: 8192,
			messages: [{ role: "user", content: "Pick" }],
		});

		await expect(answer).rejects.toThrow("Request timed out.");
		expect(calls).toHaveLength(1);
		expect(lines).toEqual([]);
	});

	it.each([
		["debug", ["debug", "info", "debug", "debug"]],
		["info", ["info"]],
		["warn", []],
		["off", []],
	] as const)("hands logLevel %s to the SDK's logger", async (logLevel, levels) => {
		const entries: LogEntry[] = [];
		const { fetch } = fakeFetch([{ status: 200, body: flashAnswer({ prompt_tokens: 3, completion_tokens: 1 }) }]);
		const { client } = door({ fetch, logLevel, logger: capturingLogger(entries) });

		await initCreateDeepseekChatCompletion({ client })({
			feature: DEEPSEEK_FEATURES.contentSelection,
			max_tokens: 8192,
			messages: [{ role: "user", content: "Pick" }],
		});

		expect(entries.map((entry) => entry.level)).toEqual(levels);
	});
});
