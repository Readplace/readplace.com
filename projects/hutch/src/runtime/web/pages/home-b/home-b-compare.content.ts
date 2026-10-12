import { MAX_PDF_BYTES, MAX_PDF_PAGES, OCR_SCRIPT_PACKS } from "@packages/crawl-article";
import { NEXT_READ_MINIMUM_SAVES, WORDS_PER_MINUTE } from "@packages/domain/article";
import { MAX_URLS_PER_IMPORT } from "@packages/domain/import-session";
import { INBOX_ADDRESS_MAX_PER_USER } from "@packages/domain/inbox";
import { MCP_OPERATIONS } from "@packages/domain/mcp";
import { READLIST_MAX_PER_USER } from "@packages/domain/readlist";
import { MAX_SUMMARY_LENGTH } from "@packages/provider-contracts";
import { CHEAPEST_MONTHLY_DISPLAY, PRICING_PLANS } from "@packages/web-shell";
import { STRIPE_TRIAL_PERIOD_DAYS } from "../../../domain/stripe/stripe-trial-config";
import { MAX_ARTICLE_HISTORY_VERSIONS } from "../../shared/article-reader/article-reader";
import { OFFLINE_COPY_MAX_AGE_MS } from "../../shared/offline-reader/offline-cache";

export const AI_PLAN_MONTHLY_USD = 200;
export const AI_PLAN_TOKEN_ALLOWANCES = {
	claudeMax: 1_050_000_000,
	chatgptPro: 210_000_000,
} as const;
export const API_LIST_PRICE = { inputUsdPerMTok: 10, outputUsdPerMTok: 50 } as const;
export const CHECKED_ON = "Oct 11, 2026";

interface HomeCompareRow {
	readonly key: string;
	readonly outcome: string;
	readonly readplace: string;
	readonly ai: string;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly feasible: "yes" | "partial" | "no";
}

interface HomeCompareFootnote {
	readonly text: string;
	readonly sources: readonly { readonly label: string; readonly href: string }[];
}

const OFFLINE_COPY_DAYS = OFFLINE_COPY_MAX_AGE_MS / (24 * 60 * 60 * 1000);
const ASSISTANT_OPERATION_COUNT = MCP_OPERATIONS.filter((operation) => operation.effect !== "appOnly").length;

export const HOME_COMPARE_ROWS: readonly HomeCompareRow[] = [
	{
		key: "archive",
		outcome: "The article still opens after the page is gone",
		readplace: `Included: one click, and the ${MAX_ARTICLE_HISTORY_VERSIONS} newest dated copies shown per article`,
		ai: "Paste the link and ask for a clean rewrite to read in the chat. Nothing is kept as an article in a readlist. Ask for a fresh copy and it's fetched and paid for again; once the page is gone, it can't be fetched at all.",
		inputTokens: 260_000,
		outputTokens: 160_000,
		feasible: "partial",
	},
	{
		key: "summaries",
		outcome: "40 saves become the 4 worth reading tonight",
		readplace: `Included: reading time and a TL;DR of up to ${MAX_SUMMARY_LENGTH} characters on every save, no meter`,
		ai: "Paste each link and ask for a summary and reading time, 40 times a month. Nothing runs until you paste, and the summaries aren't pinned to a list you can scan.",
		inputTokens: 260_000,
		outputTokens: 10_000,
		feasible: "yes",
	},
	{
		key: "pdf",
		outcome: "A scanned PDF reads as text on your phone, numbers as printed",
		readplace: `Included: up to ${MAX_PDF_PAGES} pages and ${MAX_PDF_BYTES.label}, ${OCR_SCRIPT_PACKS.length} scripts, every cleanup pass checked against the raw OCR`,
		ai: "Upload the scan and ask for a transcription. The model reads pixels and can quietly change a date or a table value, with no raw OCR layer to check it against. A long scan may need to be split across turns.",
		inputTokens: 151_000,
		outputTokens: 42_000,
		feasible: "partial",
	},
	{
		key: "newsletters",
		outcome: "Newsletter links land in your readlist on their own",
		readplace: `Included: up to ${INBOX_ADDRESS_MAX_PER_USER} addresses at read.place, one per newsletter, unsubscribe links set aside`,
		ai: "Connect Gmail and schedule a daily routine, or paste each issue. A chat can't receive mail, so every issue still lands in your inbox, and the links end up in a doc, not a readlist.",
		inputTokens: 120_000,
		outputTokens: 6_000,
		feasible: "partial",
	},
	{
		key: "import",
		outcome: "Years of Pocket saves arrive in one upload",
		readplace: `Included: up to ${MAX_URLS_PER_IMPORT.toLocaleString("en-US")} links per import, before you even have an account`,
		ai: "Give the export to a coding agent and let it fetch and summarise each link into a folder of files. The chat alone can't make 2,000 fetches, and you'd still have no reader, no list and no read state.",
		inputTokens: 1_090_000,
		outputTokens: 41_667,
		feasible: "partial",
	},
	{
		key: "search",
		outcome: "Find the piece you half-remember without scrolling",
		readplace: "Included: search by article, topic or source (not full text); filter by reading time, saved date and category",
		ai: "Keep a reading-list doc the assistant appends to on every save, then ask it questions; the whole doc rides along each time. You'd still have to build and keep the index yourself.",
		inputTokens: 252_000,
		outputTokens: 4_800,
		feasible: "partial",
	},
	{
		key: "next-read",
		outcome: "Finish an article and see what to read next from your own saves",
		readplace: `Included after ${NEXT_READ_MINIMUM_SAVES} saves: a suggestion from your own saves with a short reason, under the article when there's a match`,
		ai: "Paste the article's summary and your whole list with read marks, and ask for the closest. The chat has no record of what you finished, so you'd still have to keep that column by hand.",
		inputTokens: 485_000,
		outputTokens: 3_000,
		feasible: "partial",
	},
	{
		key: "offline",
		outcome: "Every unread article opens on the plane",
		readplace: `Included: one button on the web and on iPhone, copies kept for ${OFFLINE_COPY_DAYS} days`,
		ai: "An assistant needs the network to answer, and nothing on either plan caches articles on your device. The nearest thing is asking for the text of every unread article before you board and keeping the transcript open.",
		inputTokens: 195_000,
		outputTokens: 120_000,
		feasible: "no",
	},
	{
		key: "read-state",
		outcome: "Tick off an article, undo in one tap, and keep every dated copy",
		readplace: `Included: Undo on every mark and move, up to ${READLIST_MAX_PER_USER} readlists, the ${MAX_ARTICLE_HISTORY_VERSIONS} newest dated copies per article`,
		ai: "Ask the assistant to edit lines in the doc. Undo is you editing it back, lists are headings, and earlier versions don't exist because it never stored one.",
		inputTokens: 499_500,
		outputTokens: 2_200,
		feasible: "partial",
	},
	{
		key: "epub",
		outcome: "Tonight's long read on the Kindle or Kobo, pictures included",
		readplace: "Included: any article as an EPUB with its images and TL;DR; you move the file to the device",
		ai: "Ask for an EPUB from the code sandbox, requesting the images and a TL;DR explicitly. You'd still have to move the file to the device, same as with Readplace.",
		inputTokens: 28_000,
		outputTokens: 18_000,
		feasible: "partial",
	},
	{
		key: "assistant",
		outcome: 'Say "save the sources" mid-chat and they\'re in your readlist',
		readplace: `Included: ${ASSISTANT_OPERATION_COUNT} operations your assistant can call, on every plan`,
		ai: "Ask it to append each link to the doc; the whole list rides along every time, about 8x the tokens of calling save_link. A line in a doc is a bookmark: nothing fetches, cleans or summarises it.",
		inputTokens: 580_000,
		outputTokens: 1_200,
		feasible: "partial",
	},
];

export const HOME_COMPARE_FOOTNOTES: readonly HomeCompareFootnote[] = [
	{
		text: "The profile: 40 saves a month, finishes 10, searches 8 times, 20 newsletter issues from 5 subscriptions, 2 scanned PDFs of about 30 pages, 4 e-reader sends, and one 2,000-link import spread over 12 months; 480 saves after a year.",
		sources: [],
	},
	{
		text: `Tokens count non-cached input plus output: a 3,000-word article is about 4,000 tokens; fetching adds 2,000 tokens of page chrome and 500 of scaffolding; a clean rewrite emits 4,000; a TL;DR emits 250. A scanned page uses about 2,500 input and 700 output tokens. The list doc has 480 entries of 60–100 tokens each. Readplace estimates reading time at ${WORDS_PER_MINUTE} words per minute. Rows are priced standalone, so the total double-counts about 450,000 tokens of shared fetches and assumes no prompt-cache credit. A transcript can retain generated text; this comparison models asking for each outcome again rather than maintaining an archive yourself.`,
		sources: [],
	},
	{
		text: `The monthly allowances are estimates, not published token quotas: Claude Max 20x is modeled at ${AI_PLAN_TOKEN_ALLOWANCES.claudeMax.toLocaleString("en-US")} non-cached tokens, informed by an independent measurement of 21 accounts in October 2026. Its weekly cap binds first, and Fable models can use at most 50% of that week. ChatGPT Pro at $${AI_PLAN_MONTHLY_USD} is modeled at ${AI_PLAN_TOKEN_ALLOWANCES.chatgptPro.toLocaleString("en-US")} tokens, a human-throughput ceiling. Share = tokens ÷ modeled allowance × $${AI_PLAN_MONTHLY_USD}; it isn't an extra charge. Limits and actual usage vary.`,
		sources: [
			{ label: "Claude Max limits", href: "https://support.claude.com/en/articles/11049741-what-is-the-max-plan" },
			{ label: "Fable plan limits", href: "https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan" },
			{ label: "Independent October measurement", href: "https://wokey.ai/claude-max-limits" },
			{ label: "ChatGPT plans and limits", href: "https://learn.chatgpt.com/docs/pricing" },
		],
	},
	{
		text: `API list price uses $${API_LIST_PRICE.inputUsdPerMTok} per million input tokens and $${API_LIST_PRICE.outputUsdPerMTok} per million output tokens, the standard short-context rates for Claude Fable 5.1 and GPT-6 Astra. Opus 5.5 or GPT-6.1 Sol is 2.5–5x cheaper. Compare dollars, not tokens.`,
		sources: [
			{ label: "Anthropic API pricing", href: "https://platform.claude.com/docs/en/about-claude/pricing" },
			{ label: "GPT-6 Astra pricing", href: "https://developers.openai.com/api/docs/models/gpt-6-astra" },
			{ label: "GPT-6.1 Sol pricing", href: "https://developers.openai.com/api/docs/models/gpt-6.1-sol" },
		],
	},
	{
		text: "Offline reading can't be reproduced by tokens. The nearest stand-in uses {{offlineTokens}} tokens ({{offlineClaudeShare}} of Claude Max, {{offlineChatgptShare}} of ChatGPT Pro, about {{offlineApiUsd}} at API list price), and the total counts that approximation.",
		sources: [],
	},
	{
		text: "The import is a one-off {{importMillions}} million tokens (about {{importApiUsd}} at API list price), spread over 12 months. Storing clean copies would add about 8 million output tokens once and is left out.",
		sources: [],
	},
	{
		text: `With Readplace connected, the connector itself uses about 68,000 tokens a month in this model (${MCP_OPERATIONS.length} tool schemas per conversation plus about 400 tokens per save): {{connectorClaudeShare}} of Claude Max, {{connectorChatgptShare}} of ChatGPT Pro. The assistant still draws from its own plan.`,
		sources: [],
	},
	{
		text: "The $20 tiers are excluded because their usage limits are tighter: Claude Pro has 1/20th of Max 20x's per-session allowance, and Fable models require usage credits from the start. ChatGPT Plus has model-dependent usage limits; local messages and cloud tasks share an allowance, and weekly limits may apply.",
		sources: [
			{ label: "Claude Max versus Pro", href: "https://support.claude.com/en/articles/11049741-what-is-the-max-plan" },
			{ label: "Fable usage credits", href: "https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan" },
			{ label: "ChatGPT Plus limits", href: "https://learn.chatgpt.com/docs/pricing" },
		],
	},
];

export const HOME_COMPARE_CONTENT = {
	titleLead: `What a $${AI_PLAN_MONTHLY_USD}/month AI plan can't `,
	titleHighlight: "keep",
	titleTail: ".",
	lede: `For a reader who saves 40 articles a month, redoing all of this in a chat costs about {{tokenMillions}} million tokens: under {{claudePercentCeiling}}% of a Claude Max month, about {{chatgptPercent}}% of ChatGPT Pro, roughly {{apiApprox}} at API list price. The $${AI_PLAN_MONTHLY_USD} isn't the problem. The problem is that the tokens are spent, not saved: each clean copy lives in a transcript, scrolls away, and can be fetched and paid for again when you ask for a fresh copy. What no token buys is the part that lasts: a copy that still opens after the page is gone, a download that works on a plane, an address a newsletter can land in, an undo. Readplace is that part, from ${CHEAPEST_MONTHLY_DISPLAY}/month.`,
	caption: `Each outcome for a reader who saves 40 articles a month, with the estimated share of a $${AI_PLAN_MONTHLY_USD}/month plan it would use. Checked ${CHECKED_ON}.`,
	columns: {
		outcome: "What you get",
		readplace: "Readplace",
		ai: `With a $${AI_PLAN_MONTHLY_USD}/month AI plan`,
		share: `Share of the $${AI_PLAN_MONTHLY_USD} plan`,
	},
	total: {
		outcome: `All ${HOME_COMPARE_ROWS.length} outcomes, every month`,
		readplace: `${PRICING_PLANS.monthly.monthlyDisplay}/month, ${PRICING_PLANS.yearly.billedNote} (${PRICING_PLANS.yearly.monthlyDisplay}/month), or ${PRICING_PLANS.triennial.billedNote} (${PRICING_PLANS.triennial.monthlyDisplay}/month): every plan is the whole product`,
		ai: "{{totalTokens}} tokens a month, spent again every month, and still no copy that outlives the page, no offline reading, no address for newsletters, no one-tap undo, no dated versions, and no list that keeps itself.",
	},
	closeLead: "Keep the parts that last.",
	ctaLabel: `Try Readplace free for ${STRIPE_TRIAL_PERIOD_DAYS} days`,
} as const;
