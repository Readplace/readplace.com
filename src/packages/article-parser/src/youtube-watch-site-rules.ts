import { parseHTML } from "linkedom";
import { z } from "zod";
import { noRecovery, noTransform, skipCrawl } from "@packages/site-rules";
import type { SiteArticleContent, SiteRules } from "@packages/site-rules";

const WATCH_HOST = "www.youtube.com";
const WATCH_PATH = "/watch";
const PLAYER_RESPONSE_ASSIGNMENT = "ytInitialPlayerResponse = {";
const VIDEO_ID = /^[A-Za-z0-9_-]+$/;

const PlayerResponse = z.object({
	videoDetails: z.object({
		videoId: z.string().regex(VIDEO_ID),
		title: z.string().min(1),
		author: z.string(),
		shortDescription: z.string(),
	}),
});

export const youTubeWatchSiteRules = {
	matches: ({ url, hostname }) => hostname === WATCH_HOST && new URL(url).pathname === WATCH_PATH,
	onCrawl: skipCrawl,
	recoverContent: noRecovery,
	extract: ({ html, url }): SiteArticleContent | undefined => {
		const parsed = PlayerResponse.safeParse(playerResponseOf(html));
		if (!parsed.success) return undefined;
		const { videoId, title, author, shortDescription } = parsed.data.videoDetails;
		if (videoId !== new URL(url).searchParams.get("v")) return undefined;
		return { title, bodyHtml: watchBodyHtml({ videoId, author, shortDescription }) };
	},
	transform: noTransform,
} satisfies SiteRules;

function playerResponseOf(html: string): unknown {
	const assignment = html.indexOf(PLAYER_RESPONSE_ASSIGNMENT);
	if (assignment === -1) return undefined;
	const literal = objectLiteralAt({ text: html, start: assignment + PLAYER_RESPONSE_ASSIGNMENT.length - 1 });
	if (literal === undefined) return undefined;
	try {
		return JSON.parse(literal);
	} catch {
		return undefined;
	}
}

function objectLiteralAt(params: { text: string; start: number }): string | undefined {
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let index = params.start; index < params.text.length; index += 1) {
		const char = params.text[index];
		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') inString = true;
		else if (char === "{") depth += 1;
		else if (char === "}") {
			depth -= 1;
			if (depth === 0) return params.text.slice(params.start, index + 1);
		}
	}
	return undefined;
}

function watchBodyHtml(video: { videoId: string; author: string; shortDescription: string }): string {
	const { document } = parseHTML("<!DOCTYPE html><html><body></body></html>");
	const body = document.createElement("div");
	const channel = document.createElement("p");
	channel.textContent = video.author;
	body.appendChild(channel);
	body.appendChild(document.createTextNode("\n"));
	for (const line of video.shortDescription.split("\n")) {
		if (line.trim() === "") continue;
		const paragraph = document.createElement("p");
		paragraph.textContent = line;
		body.appendChild(paragraph);
		body.appendChild(document.createTextNode("\n"));
	}
	const embed = document.createElement("iframe");
	embed.setAttribute("src", `https://www.youtube.com/embed/${video.videoId}`);
	body.appendChild(embed);
	return body.innerHTML;
}
