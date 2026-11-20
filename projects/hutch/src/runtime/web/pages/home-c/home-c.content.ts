import { PRICING_PLANS } from "@packages/web-shell";

import { HOME_CONTENT } from "../home/home.content";
import type { HomeHero } from "../home/home-view.component";

interface HomeCapability {
	readonly key: string;
	readonly name: string;
	readonly body: string;
	readonly link?: { readonly label: string; readonly href: string; readonly content: string };
}

const HOME_C_CAPABILITY_ITEMS: readonly HomeCapability[] = [
	{
		key: "clean-reading",
		name: "Clean reading",
		body: "Every saved article opens on a clean page with its reading time at the top. Your copy stays readable even if the original goes down.",
	},
	{
		key: "summaries",
		name: "Summaries",
		body: "An AI TL;DR sits at the top of every article, so forty saved links become the four worth reading tonight.",
	},
	{
		key: "epub",
		name: "EPUB",
		body: "Download an article as an EPUB, with its images and an AI summary on the first page, for a Kobo or a Kindle.",
		link: { label: "Article to EPUB", href: "/article-to-epub", content: "article-to-epub" },
	},
];

const HOME_C_HERO: HomeHero = {
	...HOME_CONTENT.hero,
	title: "One place to keep the articles you want to come back to.",
	subhead: `Save from your browser or your iPhone. Read when you have time. Free within daily limits, with no card; the paid plan is ${PRICING_PLANS.yearly.periodDisplay} or ${PRICING_PLANS.monthly.periodDisplay}.`,
};

export const HOME_C_CONTENT = {
	hero: HOME_C_HERO,
	capabilities: {
		ariaLabel: "What Readplace does with what you keep",
		title: "What happens to what you keep",
		items: HOME_C_CAPABILITY_ITEMS,
	},
} as const;
