import { z } from "zod";

export const MAX_ARTICLE_TOPICS = 3;
export const MAX_ARTICLE_TOPIC_LENGTH = 24;

const RESERVED_ARTICLE_TOPIC_LABELS = ["Others", "Other", "Misc"];

function isReservedLabel(label: string): boolean {
	return RESERVED_ARTICLE_TOPIC_LABELS.some((reserved) => reserved.toLowerCase() === label.toLowerCase());
}

const ArticleTopicSchema = z
	.string()
	.overwrite((label) => label.replace(/\s+/g, " ").trim())
	.min(1)
	.max(MAX_ARTICLE_TOPIC_LENGTH)
	.refine((label) => !isReservedLabel(label))
	.brand<"ArticleTopic">();

export type ArticleTopic = z.infer<typeof ArticleTopicSchema>;

export function toArticleTopics(raw: readonly string[]): ArticleTopic[] {
	const topics: ArticleTopic[] = [];
	const seen = new Set<string>();
	for (const label of raw) {
		const parsed = ArticleTopicSchema.safeParse(label);
		if (!parsed.success) continue;
		const key = parsed.data.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		topics.push(parsed.data);
	}
	return topics.slice(0, MAX_ARTICLE_TOPICS);
}
