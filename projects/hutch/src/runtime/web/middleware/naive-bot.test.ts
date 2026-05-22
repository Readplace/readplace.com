import type { Request, Response } from "express";
import type { HutchLogger } from "@packages/hutch-logger";
import { type BotBlockEvent, createBlockNaiveBotMiddleware } from "./naive-bot";

interface RunResult {
	status?: number;
	nextCalled: boolean;
	logged: BotBlockEvent[];
}

function run({ ua, path = "/" }: { ua?: string; path?: string }): RunResult {
	let status: number | undefined;
	let nextCalled = false;
	const res = {
		status(code: number) {
			status = code;
			return res;
		},
		end() {},
	};

	const headers: Record<string, string | undefined> = { "user-agent": ua };
	const req = {
		path,
		get(name: string): string | undefined {
			return headers[name.toLowerCase()];
		},
	};

	const logged: BotBlockEvent[] = [];
	const logger: HutchLogger.Typed<BotBlockEvent> = {
		info: (data) => { logged.push(data); },
		error: () => {},
		warn: () => {},
		debug: () => {},
	};

	const next = () => { nextCalled = true; };
	createBlockNaiveBotMiddleware({ logger })(req as Request, res as Response, next);
	return { status, nextCalled, logged };
}

describe("createBlockNaiveBotMiddleware", () => {
	it("allows a modern browser UA", () => {
		const result = run({
			ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		});
		expect(result.nextCalled).toBe(true);
		expect(result.status).toBeUndefined();
		expect(result.logged).toEqual([]);
	});

	it("allows Googlebot — the policy must not block any legitimate crawler, including ones isbot() would flag", () => {
		const result = run({
			ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
		});
		expect(result.nextCalled).toBe(true);
		expect(result.status).toBeUndefined();
	});

	it("allows GPTBot — robots.txt at projects/hutch/src/runtime/server.ts:258-259 explicitly allows it", () => {
		const result = run({
			ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
		});
		expect(result.nextCalled).toBe(true);
	});

	it("allows ClaudeBot — robots.txt at projects/hutch/src/runtime/server.ts:264-265 explicitly allows it", () => {
		const result = run({
			ua: "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
		});
		expect(result.nextCalled).toBe(true);
	});

	it("allows PerplexityBot — robots.txt at projects/hutch/src/runtime/server.ts:261-262 explicitly allows it", () => {
		const result = run({
			ua: "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
		});
		expect(result.nextCalled).toBe(true);
	});

	it("allows an unknown crawler — the policy assumes good faith for any UA not on the explicit block-list, so a future search engine we have never heard of still gets to index us", () => {
		const result = run({
			ua: "Mozilla/5.0 (compatible; FlimsyBot/1.0; +https://flimsy.example/bot)",
		});
		expect(result.nextCalled).toBe(true);
	});

	it("allows empty UA — missing UA is not a high-confidence bot signal (could be a misconfigured legit client) so we err on the side of allow", () => {
		const result = run({ ua: "" });
		expect(result.nextCalled).toBe(true);
		expect(result.status).toBeUndefined();
	});

	it("allows missing UA header — same reasoning as empty UA", () => {
		const result = run({ ua: undefined });
		expect(result.nextCalled).toBe(true);
		expect(result.status).toBeUndefined();
	});

	it("blocks curl with 403 and logs one bot-block event", () => {
		const result = run({ ua: "curl/7.88.1" });
		expect(result.status).toBe(403);
		expect(result.nextCalled).toBe(false);
		expect(result.logged).toEqual([
			{ stream: "bot-block", event: "blocked", path: "/", user_agent: "curl/7.88.1" },
		]);
	});

	it("blocks Wget", () => {
		expect(run({ ua: "Wget/1.21.3" }).status).toBe(403);
	});

	it("blocks libcurl", () => {
		expect(run({ ua: "libcurl/7.88.0 mbedTLS/3.0.0" }).status).toBe(403);
	});

	it("blocks python-requests", () => {
		expect(run({ ua: "python-requests/2.31.0" }).status).toBe(403);
	});

	it("blocks Python-urllib", () => {
		expect(run({ ua: "Python-urllib/3.11" }).status).toBe(403);
	});

	it("blocks aiohttp", () => {
		expect(run({ ua: "aiohttp/3.9.1" }).status).toBe(403);
	});

	it("blocks Go-http-client", () => {
		expect(run({ ua: "Go-http-client/1.1" }).status).toBe(403);
	});

	it("blocks Java default UA", () => {
		expect(run({ ua: "Java/17.0.2" }).status).toBe(403);
	});

	it("blocks okhttp", () => {
		expect(run({ ua: "okhttp/4.10.0" }).status).toBe(403);
	});

	it("blocks Apache-HttpClient", () => {
		expect(run({ ua: "Apache-HttpClient/4.5.13 (Java/11.0.16)" }).status).toBe(403);
	});

	it("blocks node-fetch", () => {
		expect(run({ ua: "node-fetch/1.0 (+https://github.com/bitinn/node-fetch)" }).status).toBe(403);
	});

	it("blocks axios", () => {
		expect(run({ ua: "axios/1.6.2" }).status).toBe(403);
	});

	it("blocks Ruby default", () => {
		expect(run({ ua: "Ruby" }).status).toBe(403);
	});

	it("blocks Faraday", () => {
		expect(run({ ua: "Faraday v2.7.10" }).status).toBe(403);
	});

	it("blocks PHP default", () => {
		expect(run({ ua: "PHP/8.2.0" }).status).toBe(403);
	});

	it("blocks GuzzleHttp", () => {
		expect(run({ ua: "GuzzleHttp/7.5.0 curl/7.81.0 PHP/8.1.0" }).status).toBe(403);
	});

	it("blocks Scrapy", () => {
		expect(run({ ua: "Scrapy/2.11.0 (+https://scrapy.org)" }).status).toBe(403);
	});

	it("bypasses the block for /robots.txt so crawlers can always read the crawl policy", () => {
		const result = run({ ua: "curl/7.88.1", path: "/robots.txt" });
		expect(result.nextCalled).toBe(true);
		expect(result.status).toBeUndefined();
		expect(result.logged).toEqual([]);
	});

	it("bypasses the block for /sitemap.xml", () => {
		expect(run({ ua: "curl/7.88.1", path: "/sitemap.xml" }).nextCalled).toBe(true);
	});

	it("bypasses the block for /llms.txt", () => {
		expect(run({ ua: "curl/7.88.1", path: "/llms.txt" }).nextCalled).toBe(true);
	});

	it("bypasses the block for /llms-full.txt", () => {
		expect(run({ ua: "curl/7.88.1", path: "/llms-full.txt" }).nextCalled).toBe(true);
	});

	it("bypasses the block for /favicon.ico", () => {
		expect(run({ ua: "curl/7.88.1", path: "/favicon.ico" }).nextCalled).toBe(true);
	});

	it("truncates logged user_agent to 200 chars so a malicious 10KB UA cannot blow up the log line size", () => {
		const longUa = `curl/${"x".repeat(500)}`;
		const result = run({ ua: longUa });
		expect(result.status).toBe(403);
		expect(result.logged).toHaveLength(1);
		expect(result.logged[0]?.user_agent.length).toBe(200);
		expect(result.logged[0]?.user_agent.startsWith("curl/xxx")).toBe(true);
	});
});
