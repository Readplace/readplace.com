import assert from "node:assert";
import { parseYouTubeEmbed } from "@packages/crawl-article";
import { type DisplayableReadTime, type EnclosureRead, displayableReadTime } from "@packages/domain/article";
import { MEDIA_KINDS } from "@packages/media-contracts";

function listenTimeOf(mediaType: string): (seconds: number) => number {
	const manifest = [...MEDIA_KINDS.values()].find((kind) => mediaType in kind.accepts);
	assert(manifest?.listenTime, `no media kind gives ${mediaType} a listen time`);
	return manifest.listenTime;
}

type TimedArticle = Parameters<typeof displayableReadTime>[0] & { url: string };

export function displayableArticleReadTime(article: TimedArticle): DisplayableReadTime | undefined {
	if (parseYouTubeEmbed(article.url)?.kind === "video") return undefined;
	return displayableReadTime(article);
}

export function displayableTime(input: {
	article: TimedArticle;
	enclosure: EnclosureRead;
}): DisplayableReadTime | undefined {
	if (input.enclosure.kind === "absent") return displayableArticleReadTime(input.article);
	const { mediaType, durationSeconds } = input.enclosure.enclosure;
	const minutes = String(listenTimeOf(mediaType)(durationSeconds));
	return { value: minutes, label: `${minutes} min listen` };
}
