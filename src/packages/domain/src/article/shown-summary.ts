import { z } from "zod";
import type { UserId } from "../user";
import { type GeneratedContentAccess, SUMMARY_WITHHELD_REASON } from "./generated-content";
import { isNonArticleHost } from "./non-article-host";
import { mayReadItem, type Viewer } from "./private-item-access";
import type { SummaryStage } from "./progress-mapping";

export type GeneratedSummary =
	| { status: "pending"; stage?: SummaryStage }
	| { status: "ready"; summary: string; excerpt?: string }
	| { status: "failed"; reason: string }
	| { status: "skipped"; reason?: string };

const ShownSummarySchema = z.custom<GeneratedSummary>().brand<"ShownSummary">();
export type ShownSummary = z.infer<typeof ShownSummarySchema>;

export function shownSummary(stored: {
	url: string;
	summary: GeneratedSummary | undefined;
	viewer: Viewer;
	ownerUserId: UserId | undefined;
	generatedContent: GeneratedContentAccess;
}): ShownSummary | undefined {
	if (isNonArticleHost(stored.url)) return ShownSummarySchema.parse({ status: "skipped" });
	if (!mayReadItem(stored)) return ShownSummarySchema.parse({ status: "skipped" });
	if (stored.generatedContent === "withheld")
		return ShownSummarySchema.parse({ status: "skipped", reason: SUMMARY_WITHHELD_REASON });
	if (stored.summary === undefined) return undefined;
	return ShownSummarySchema.parse(stored.summary);
}
