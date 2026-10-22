import { parseHTML } from "linkedom";
import { z } from "zod";
import { noRecovery, noTransform, skipCrawl } from "@packages/site-rules";
import type { SiteArticleContent, SiteRules } from "@packages/site-rules";
import { parseYouTubeEmbed } from "./parse-embed-url";

const playerSchema = z.object({
	playabilityStatus: z.object({
		status: z.literal("OK"),
		playableInEmbed: z.literal(true),
	}),
	videoDetails: z.object({
		videoId: z.string().min(1),
		title: z.string().min(1),
		shortDescription: z.string().min(1),
	}),
});

function assignedPlayer(script: string): unknown {
	const assignment = /\bytInitialPlayerResponse\s*=\s*(\{)/.exec(script);
	if (!assignment) return undefined;
	const start = assignment.index + assignment[0].lastIndexOf("{");
	let depth = 0;
	let quoted = false;
	let escaped = false;
	for (let index = start; index < script.length; index++) {
		const character = script[index];
		if (quoted) {
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === '"') quoted = false;
			continue;
		}
		if (character === '"') quoted = true;
		else if (character === "{") depth++;
		else if (character === "}" && --depth === 0) {
			try {
				return JSON.parse(script.slice(start, index + 1));
			} catch {
				return undefined;
			}
		}
	}
	return undefined;
}

export const youtubeSiteRules = {
	matches: ({ hostname }) => hostname === "youtube.com" || hostname === "www.youtube.com" || hostname === "m.youtube.com" || hostname === "music.youtube.com",
	onCrawl: skipCrawl,
	recoverContent: noRecovery,
	extract: ({ html, url }): SiteArticleContent | undefined => {
		if (!url) return undefined;
		const requested = parseYouTubeEmbed(url);
		if (requested?.kind !== "video") return undefined;
		const { document } = parseHTML(html);
		for (const script of document.querySelectorAll("script")) {
			const parsed = playerSchema.safeParse(assignedPlayer(script.textContent));
			if (!parsed.success || parsed.data.videoDetails.videoId !== requested.videoId) continue;
			const container = document.createElement("div");
			const description = document.createElement("p");
			description.textContent = parsed.data.videoDetails.shortDescription;
			container.appendChild(description);
			const iframe = document.createElement("iframe");
			iframe.setAttribute("src", `https://www.youtube.com/embed/${requested.videoId}`);
			container.appendChild(iframe);
			return { title: parsed.data.videoDetails.title, bodyHtml: container.innerHTML };
		}
		return undefined;
	},
	transform: noTransform,
} satisfies SiteRules;
