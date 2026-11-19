import assert from "node:assert";
import { parseHTML } from "linkedom";
import { z } from "zod";
import { parseYouTubeEmbed } from "@packages/crawl-article";
import { noRecovery, noTransform, skipCrawl } from "@packages/site-rules";
import type { SiteArticleContent, SiteRules } from "@packages/site-rules";

const YOUTUBE_ORIGIN = "https://www.youtube.com";
const SCRIPT_PREFIX = "var ytInitialData = ";

const VideoId = z.string().regex(/^[A-Za-z0-9_-]+$/);

const InnertubeCommand = z.object({
	commandMetadata: z.object({ webCommandMetadata: z.object({ url: z.string() }) }),
	watchEndpoint: z.object({ videoId: VideoId, startTimeSeconds: z.number() }).optional(),
});
type InnertubeCommand = z.infer<typeof InnertubeCommand>;

const CommandRun = z.object({
	startIndex: z.number(),
	length: z.number(),
	onTap: z.object({ innertubeCommand: InnertubeCommand }),
});
type CommandRun = z.infer<typeof CommandRun>;

const Description = z.object({ content: z.string(), commandRuns: z.array(CommandRun) });
type Description = z.infer<typeof Description>;

const PrimaryInfo = z.object({
	title: z.object({ runs: z.array(z.object({ text: z.string() })).min(1) }),
	dateText: z.object({ simpleText: z.string() }),
	viewCount: z.object({ videoViewCountRenderer: z.object({ viewCount: z.object({ simpleText: z.string() }) }) }),
});

const ChannelRun = z.object({
	text: z.string(),
	navigationEndpoint: z.object({ browseEndpoint: z.object({ canonicalBaseUrl: z.string() }) }),
});

const SecondaryInfo = z.object({
	owner: z.object({ videoOwnerRenderer: z.object({ title: z.object({ runs: z.tuple([ChannelRun]).rest(z.unknown()) }) }) }),
	attributedDescription: Description,
});

const WatchResults = z
	.array(z.record(z.string(), z.unknown()))
	.transform((entries) => Object.assign({}, ...entries))
	.pipe(z.object({ videoPrimaryInfoRenderer: PrimaryInfo, videoSecondaryInfoRenderer: SecondaryInfo }));

const YtInitialData = z.object({
	currentVideoEndpoint: z.object({ watchEndpoint: z.object({ videoId: VideoId }) }),
	contents: z.object({
		twoColumnWatchNextResults: z.object({
			results: z.object({ results: z.object({ contents: WatchResults }) }),
		}),
	}),
});

export const youtubeSiteRules = {
	matches: ({ url }) => parseYouTubeEmbed(url)?.kind === "video",
	onCrawl: skipCrawl,
	recoverContent: noRecovery,
	extract: ({ html }): SiteArticleContent | undefined => {
		const { document } = parseHTML(html);
		const text = Array.from(document.querySelectorAll("script"))
			.map((script) => String(script.textContent).trim())
			.find((scriptText) => scriptText.startsWith(SCRIPT_PREFIX));
		if (!text) return undefined;

		let raw: unknown;
		try {
			raw = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
		} catch {
			return undefined;
		}

		const parsed = YtInitialData.safeParse(raw);
		if (!parsed.success) return undefined;
		const videoId = parsed.data.currentVideoEndpoint.watchEndpoint.videoId;
		const { videoPrimaryInfoRenderer: primary, videoSecondaryInfoRenderer: secondary } =
			parsed.data.contents.twoColumnWatchNextResults.results.results.contents;

		const metaDescription = document.querySelector('meta[name="description"]');
		assert(metaDescription, "a YouTube watch page carries a meta description");
		const excerpt = metaDescription.getAttribute("content");
		assert(excerpt !== null, "a YouTube watch page's meta description has content");

		const container = document.createElement("div");

		const embed = document.createElement("iframe");
		embed.setAttribute("src", `${YOUTUBE_ORIGIN}/embed/${videoId}`);
		container.appendChild(embed);

		const [channel] = secondary.owner.videoOwnerRenderer.title.runs;
		const metadata = document.createElement("p");
		const channelLink = document.createElement("a");
		channelLink.setAttribute("href", new URL(channel.navigationEndpoint.browseEndpoint.canonicalBaseUrl, YOUTUBE_ORIGIN).href);
		channelLink.textContent = channel.text;
		metadata.appendChild(channelLink);
		metadata.appendChild(
			document.createTextNode(
				` · ${primary.dateText.simpleText} · ${primary.viewCount.videoViewCountRenderer.viewCount.simpleText}`,
			),
		);
		container.appendChild(metadata);

		appendDescription({ document, container, description: secondary.attributedDescription });

		return {
			title: primary.title.runs.map((run) => run.text).join(""),
			excerpt,
			bodyHtml: container.innerHTML,
		};
	},
	transform: noTransform,
} satisfies SiteRules;

function appendDescription(params: { document: Document; container: Element; description: Description }): void {
	const { document, container, description } = params;
	let paragraph: Element | undefined;
	let list: Element | undefined;
	let lineStart = 0;
	for (const line of description.content.split("\n")) {
		const start = lineStart;
		lineStart += line.length + 1;
		if (line === "") {
			paragraph = undefined;
			list = undefined;
			continue;
		}
		const runs = description.commandRuns.filter(
			(run) => run.startIndex >= start && run.startIndex + run.length <= start + line.length,
		);
		const isChapter = runs.some(
			(run) => run.startIndex === start && run.onTap.innertubeCommand.watchEndpoint !== undefined,
		);
		if (isChapter) {
			paragraph = undefined;
			if (!list) {
				list = document.createElement("ul");
				container.appendChild(list);
			}
			const item = document.createElement("li");
			appendLine({ document, parent: item, line, start, runs });
			list.appendChild(item);
			continue;
		}
		list = undefined;
		if (paragraph) {
			paragraph.appendChild(document.createElement("br"));
		} else {
			paragraph = document.createElement("p");
			container.appendChild(paragraph);
		}
		appendLine({ document, parent: paragraph, line, start, runs });
	}
}

function appendLine(params: {
	document: Document;
	parent: Element;
	line: string;
	start: number;
	runs: readonly CommandRun[];
}): void {
	const { document, parent, line } = params;
	let cursor = 0;
	for (const run of params.runs) {
		const from = run.startIndex - params.start;
		parent.appendChild(document.createTextNode(line.slice(cursor, from)));
		const link = document.createElement("a");
		link.setAttribute("href", hrefOf(run.onTap.innertubeCommand));
		link.textContent = line.slice(from, from + run.length);
		parent.appendChild(link);
		cursor = from + run.length;
	}
	parent.appendChild(document.createTextNode(line.slice(cursor)));
}

function hrefOf(command: InnertubeCommand): string {
	const moment = command.watchEndpoint;
	if (moment) return `${YOUTUBE_ORIGIN}/watch?v=${moment.videoId}&t=${moment.startTimeSeconds}s`;
	const url = new URL(command.commandMetadata.webCommandMetadata.url, YOUTUBE_ORIGIN);
	if (url.pathname !== "/redirect") return url.href;
	return url.searchParams.get("q") ?? url.href;
}
