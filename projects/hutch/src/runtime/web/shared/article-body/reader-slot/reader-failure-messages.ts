import type {
	CrawlFailureReason,
	CrawlUnsupportedReason,
} from "@packages/article-state-types";

export function messageForCrawlFailure(reason: CrawlFailureReason): string {
	switch (reason.kind) {
		case "parse-error":
			return "We fetched the page but couldn't extract the article content.";
		case "fetch-failed":
			return reason.httpStatus !== undefined
				? `The site returned an error (HTTP ${reason.httpStatus}) when we tried to fetch it.`
				: "We couldn't reach the article's host.";
		case "origin-unreachable":
			return reason.httpStatus !== undefined
				? `The site's own server was unreachable (HTTP ${reason.httpStatus}) when we tried to fetch it — the site was down, not blocking us.`
				: "The site's own server was unreachable when we tried to fetch it — the site was down, not blocking us.";
		case "exhausted-retries":
			return "We retried fetching this article several times without success.";
		case "not-found":
			return `The page no longer exists at this address (HTTP ${reason.httpStatus}).`;
		case "blocked":
			switch (reason.cause) {
				case "edge-block":
				case "rate-limited":
					return "The site blocked our servers from fetching it. Open it in your browser and we'll capture it from there.";
				case "robots":
					return "The site's robots.txt asks us not to crawl this URL.";
				case "spend-capped":
					return "We hit our own processing limit for this file, so we couldn't extract its content.";
			}
	}
}

export function messageForCrawlUnsupported(
	reason: CrawlUnsupportedReason,
): string {
	switch (reason.kind) {
		case "non-html-content":
			return `This URL points to a non-HTML resource (${reason.contentType}) we can't render in the reader.`;
		case "paywall":
			return "This article is behind a paywall.";
		case "javascript-required":
			return "This page requires JavaScript to render, which we can't process server-side.";
		case "content-too-large":
			return "This page is too large to process in the reader.";
	}
}
