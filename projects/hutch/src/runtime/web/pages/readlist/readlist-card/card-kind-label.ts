import assert from "node:assert";
import type { DisplayableReadTime, ItemMedia, Minutes } from "@packages/domain/article";
import { MEDIA_KINDS, type MediaKindName } from "@packages/media-contracts";
import type { IconName } from "@packages/ui-icons";

export interface CardKind {
	name: MediaKindName;
	label: string;
	noun: string;
	icon: IconName;
}

interface KindLabelInput {
	label: string;
	estimatedReadTime: Minutes;
	wordCount: number;
	sectionCount: number | undefined;
	readTime: DisplayableReadTime | undefined;
}

type KindLabel = (input: KindLabelInput) => string;

const KIND_BADGE_ICON: Record<MediaKindName, IconName> = { book: "book", audio: "headphones", video: "video" };

export function hoursAndMinutesRead(minutes: Minutes): string {
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	if (hours === 0) return `${rest} min read`;
	if (rest === 0) return `${hours} h read`;
	return `${hours} h ${rest} min read`;
}

const timedKindLabel: KindLabel = ({ label, readTime }) =>
	[label, readTime?.label].filter((part) => part !== undefined).join(" · ");

const CARD_KIND_LABEL: Record<MediaKindName, KindLabel> = {
	book: ({ label, estimatedReadTime, wordCount, sectionCount }) =>
		[label, sectionCount === undefined ? undefined : `${sectionCount} ${sectionCount === 1 ? "chapter" : "chapters"}`, wordCount > 0 ? hoursAndMinutesRead(estimatedReadTime) : undefined]
			.filter((part) => part !== undefined)
			.join(" · "),
	audio: timedKindLabel,
	video: timedKindLabel,
};

export function cardKindOf(article: { media?: ItemMedia }): { kind: CardKind } | undefined {
	if (article.media === undefined) return undefined;
	const name = article.media.kind;
	const manifest = MEDIA_KINDS.get(name);
	assert(manifest, `no media kind manifest for ${name}`);
	return { kind: { name, label: manifest.label, noun: manifest.label.toLowerCase(), icon: KIND_BADGE_ICON[name] } };
}

export function cardKindLabel(input: Omit<KindLabelInput, "label"> & { kind: CardKind }): string {
	const { kind, ...rest } = input;
	return CARD_KIND_LABEL[kind.name]({ ...rest, label: kind.label });
}
