import assert from "node:assert";
import { type DisplayableReadTime, type EnclosureRead, displayableReadTime } from "@packages/domain/article";
import { MEDIA_KINDS } from "@packages/media-contracts";

function listenTimeOf(mediaType: string): (seconds: number) => number {
	const manifest = [...MEDIA_KINDS.values()].find((kind) => mediaType in kind.accepts);
	assert(manifest?.listenTime, `no media kind gives ${mediaType} a listen time`);
	return manifest.listenTime;
}

export function displayableTime(input: {
	article: Parameters<typeof displayableReadTime>[0];
	enclosure: EnclosureRead;
}): DisplayableReadTime | undefined {
	if (input.enclosure.kind === "absent") return displayableReadTime(input.article);
	const { mediaType, durationSeconds } = input.enclosure.enclosure;
	const minutes = String(listenTimeOf(mediaType)(durationSeconds));
	return { value: minutes, label: `${minutes} min listen` };
}
