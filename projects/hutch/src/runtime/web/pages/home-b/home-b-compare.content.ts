import { PRICING_PLANS } from "@packages/web-shell";
import { STRIPE_TRIAL_PERIOD_DAYS } from "../../../domain/stripe/stripe-trial-config";

const AI_PLAN_MONTHLY_USD = 200;
const MONTHS_PER_YEAR = 12;
const CHECKED_ON = "Oct 13, 2026";

const AI_PLAN_MONTHLY = `$${AI_PLAN_MONTHLY_USD}`;
const AI_PLAN_YEARLY = `$${(AI_PLAN_MONTHLY_USD * MONTHS_PER_YEAR).toLocaleString("en-US")}`;

export type HomeCompareTone = "readplace" | "ai";

type HomeComparePrice = { readonly key: string; readonly label: string } & Readonly<Record<HomeCompareTone, string>>;

interface HomeCompareFeature {
	readonly key: string;
	readonly label: string;
}

export const HOME_COMPARE_PRICES: readonly HomeComparePrice[] = [
	{ key: "month", label: "Per month", readplace: PRICING_PLANS.yearly.monthlyDisplay, ai: AI_PLAN_MONTHLY },
	{ key: "year", label: "Per year", readplace: PRICING_PLANS.yearly.totalDisplay, ai: AI_PLAN_YEARLY },
];

export const HOME_COMPARE_FEATURES: readonly HomeCompareFeature[] = [
	{ key: "read-later", label: "Saves articles to read later" },
	{ key: "backup", label: "Backs up pages you save, automatically" },
	{ key: "offline", label: "Downloads saved articles to read offline" },
	{ key: "newsletters", label: "Saves links from your newsletters" },
];

export const HOME_COMPARE_CONTENT = {
	ariaLabel: "Readplace compared with Claude and ChatGPT",
	titleLead: "Your reading list for ",
	titleHighlight: PRICING_PLANS.yearly.monthlyDisplay,
	titleTail: `/month, not ${AI_PLAN_MONTHLY}/month.`,
	lede: `Claude's and ChatGPT's ${AI_PLAN_MONTHLY}/month plans cost ${AI_PLAN_YEARLY}/year each, and neither has a reading list. Readplace gives you one for ${PRICING_PLANS.yearly.totalDisplay}/year.`,
	caption: "Price and reading features of Readplace, Claude Max 20x and ChatGPT Pro 200",
	columns: {
		feature: "What you get",
		readplace: "Readplace",
		claude: "Claude Max 20x",
		chatgpt: "ChatGPT Pro 200",
	},
	note: `Readplace prices show the yearly plan. Claude and ChatGPT bill these plans monthly only, as of ${CHECKED_ON}.`,
	ctaLabel: `Try Readplace free for ${STRIPE_TRIAL_PERIOD_DAYS} days`,
	ctaReassurance: "No card. Cancel anytime. Your saved articles stay readable after you stop paying.",
} as const;
