import { z } from "zod";
import { isNonArticleHost } from "./non-article-host";
import type { SummaryStage } from "./progress-mapping";

export type GeneratedSummary =
	| { status: "pending"; stage?: SummaryStage }
	| { status: "ready"; summary: string; excerpt?: string }
	| { status: "failed"; reason: string }
	| { status: "skipped"; reason?: string };

const ShownSummarySchema = z.custom<GeneratedSummary>().brand<"ShownSummary">();
export type ShownSummary = z.infer<typeof ShownSummarySchema>;

export function shownSummary(stored: { url: string; summary: GeneratedSummary | undefined }): ShownSummary | undefined {
	if (isNonArticleHost(stored.url)) return ShownSummarySchema.parse({ status: "skipped" });
	if (stored.summary === undefined) return undefined;
	return ShownSummarySchema.parse(stored.summary);
}
