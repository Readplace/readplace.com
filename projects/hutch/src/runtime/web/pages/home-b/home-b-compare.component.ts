import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";
import {
	AI_PLAN_MONTHLY_USD,
	AI_PLAN_TOKEN_ALLOWANCES,
	API_LIST_PRICE,
	HOME_COMPARE_CONTENT,
	HOME_COMPARE_FOOTNOTES,
	HOME_COMPARE_ROWS,
} from "./home-b-compare.content";

const TEMPLATE = readFileSync(join(__dirname, "home-b-compare.template.html"), "utf-8");

function dollars(amount: number): string {
	return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function planShare(input: { tokens: number; allowance: number }): number {
	return input.tokens / input.allowance * AI_PLAN_MONTHLY_USD;
}

function apiDollars(input: { inputTokens: number; outputTokens: number }): number {
	return (input.inputTokens * API_LIST_PRICE.inputUsdPerMTok + input.outputTokens * API_LIST_PRICE.outputUsdPerMTok) / 1_000_000;
}

export function renderHomeCompareSection(): string {
	const total = HOME_COMPARE_ROWS.reduce((sum, row) => ({
		inputTokens: sum.inputTokens + row.inputTokens,
		outputTokens: sum.outputTokens + row.outputTokens,
	}), { inputTokens: 0, outputTokens: 0 });
	const totalTokens = total.inputTokens + total.outputTokens;
	const claudeShare = planShare({ tokens: totalTokens, allowance: AI_PLAN_TOKEN_ALLOWANCES.claudeMax });
	const chatgptShare = planShare({ tokens: totalTokens, allowance: AI_PLAN_TOKEN_ALLOWANCES.chatgptPro });
	const apiTotal = apiDollars(total);
	const offline = HOME_COMPARE_ROWS.find((row) => row.key === "offline");
	const imported = HOME_COMPARE_ROWS.find((row) => row.key === "import");
	assert(offline);
	assert(imported);
	const offlineTokens = offline.inputTokens + offline.outputTokens;
	const footnoteNumbers = {
		offlineTokens: offlineTokens.toLocaleString("en-US"),
		offlineClaudeShare: dollars(planShare({ tokens: offlineTokens, allowance: AI_PLAN_TOKEN_ALLOWANCES.claudeMax })),
		offlineChatgptShare: dollars(planShare({ tokens: offlineTokens, allowance: AI_PLAN_TOKEN_ALLOWANCES.chatgptPro })),
		offlineApiUsd: dollars(Math.round(apiDollars(offline))),
		importMillions: ((imported.inputTokens + imported.outputTokens) * 12 / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 }),
		importApiUsd: dollars(Math.round(apiDollars(imported) * 12)),
		connectorClaudeShare: dollars(planShare({ tokens: 68_000, allowance: AI_PLAN_TOKEN_ALLOWANCES.claudeMax })),
		connectorChatgptShare: dollars(planShare({ tokens: 68_000, allowance: AI_PLAN_TOKEN_ALLOWANCES.chatgptPro })),
	};
	return render(TEMPLATE, {
		...HOME_COMPARE_CONTENT,
		lede: render(HOME_COMPARE_CONTENT.lede, {
			tokenMillions: (totalTokens / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 }),
			claudePercentCeiling: Math.ceil(claudeShare / AI_PLAN_MONTHLY_USD * 100),
			chatgptPercent: Math.round(chatgptShare / AI_PLAN_MONTHLY_USD * 100),
			apiApprox: dollars(Math.round(apiTotal)).replace(".00", ""),
		}),
		rows: HOME_COMPARE_ROWS.map((row) => {
			const tokens = row.inputTokens + row.outputTokens;
			return {
				...row,
				share: row.feasible === "no" ? "Not possible" : `Claude Max: ${dollars(planShare({ tokens, allowance: AI_PLAN_TOKEN_ALLOWANCES.claudeMax }))}; ChatGPT Pro: ${dollars(planShare({ tokens, allowance: AI_PLAN_TOKEN_ALLOWANCES.chatgptPro }))}`,
			};
		}),
		total: {
			...HOME_COMPARE_CONTENT.total,
			ai: render(HOME_COMPARE_CONTENT.total.ai, { totalTokens: totalTokens.toLocaleString("en-US") }),
			share: `${dollars(claudeShare)} of Claude Max, ${dollars(chatgptShare)} of ChatGPT Pro (about ${dollars(Math.round(apiTotal)).replace(".00", "")} at API list price)`,
		},
		footnotes: HOME_COMPARE_FOOTNOTES.map((note) => ({ ...note, text: render(note.text, footnoteNumbers) })),
		ctaHref: withInternalTracking("/signup", { source: "home-compare", content: "compare-signup" }),
	});
}
