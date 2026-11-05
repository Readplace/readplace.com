import assert from "node:assert";
import type { ItemMedia, Minutes } from "@packages/domain/article";
import { MEDIA_KINDS, type MediaKindName } from "@packages/media-contracts";
import type { IconName } from "@packages/ui-icons";

export interface CardKind {
	name: MediaKindName;
	label: string;
	noun: string;
	icon: IconName;
}

type KindLabel = (input: { label: string; estimatedReadTime: Minutes; wordCount: number; sectionCount: number | undefined }) => string;

const KIND_BADGE_ICON: Record<MediaKindName, IconName> = { book: "book" };

export function hoursAndMinutesRead(minutes: Minutes): string {
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	if (hours === 0) return `${rest} min read`;
	if (rest === 0) return `${hours} h read`;
	return `${hours} h ${rest} min read`;
}

const CARD_KIND_LABEL: Record<MediaKindName, KindLabel> = {
	book: ({ label, estimatedReadTime, wordCount, sectionCount }) =>
		[label, sectionCount === undefined ? undefined : `${sectionCount} ${sectionCount === 1 ? "chapter" : "chapters"}`, wordCount > 0 ? hoursAndMinutesRead(estimatedReadTime) : undefined]
			.filter((part) => part !== undefined)
			.join(" · "),
};

export function cardKindOf(
	article: { media?: ItemMedia; metadata: { wordCount: number }; estimatedReadTime: Minutes },
): { kind: CardKind; kindLabel: string } | undefined {
	if (article.media === undefined) return undefined;
	const name = article.media.kind;
	const manifest = MEDIA_KINDS.get(name);
	assert(manifest, `no media kind manifest for ${name}`);
	return {
		kind: { name, label: manifest.label, noun: manifest.label.toLowerCase(), icon: KIND_BADGE_ICON[name] },
		kindLabel: CARD_KIND_LABEL[name]({
			label: manifest.label,
			estimatedReadTime: article.estimatedReadTime,
			wordCount: article.metadata.wordCount,
			sectionCount: article.media.sectionCount,
		}),
	};
}
