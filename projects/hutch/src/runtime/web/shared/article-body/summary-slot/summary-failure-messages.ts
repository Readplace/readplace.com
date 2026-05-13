import type { SummaryFailureReason } from "@packages/article-state-types";

export function messageForSummaryFailure(reason: SummaryFailureReason): string {
	switch (reason.kind) {
		case "exhausted-retries":
			return "We retried several times but the AI summary kept failing. We've stopped retrying for now.";
		case "crawl-failed":
			return "We couldn't summarise this article because the crawl didn't succeed.";
		case "model-overload":
			return "The AI summariser was overloaded. We'll try again later.";
		case "content-too-large":
			return "This article is too long to summarise with the current AI model.";
	}
}
