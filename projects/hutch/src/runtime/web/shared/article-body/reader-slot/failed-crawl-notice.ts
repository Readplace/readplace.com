import {
	type CrawlFailureReason,
	type ReaderFailedVariant,
	parseCrawlFailureReason,
} from "@packages/article-state-types";

export interface FailedCrawlNotice {
	variant: ReaderFailedVariant;
}

const NOTICE_BY_FAILURE_KIND = {
	"parse-error": { variant: "failed" },
	"fetch-failed": { variant: "failed" },
	"exhausted-retries": { variant: "failed" },
	"origin-unreachable": { variant: "origin-down" },
	"not-found": { variant: "not-found" },
} satisfies Record<Exclude<CrawlFailureReason["kind"], "blocked">, FailedCrawlNotice>;

const NOTICE_BY_BLOCK_CAUSE = {
	"edge-block": { variant: "blocked" },
	"rate-limited": { variant: "blocked" },
	"spend-capped": { variant: "failed" },
	robots: { variant: "failed" },
} satisfies Record<Extract<CrawlFailureReason, { kind: "blocked" }>["cause"], FailedCrawlNotice>;

const UNREADABLE_REASON_NOTICE: FailedCrawlNotice = { variant: "failed" };

export function failedCrawlNotice(reason: string): FailedCrawlNotice {
	const parsed = parseCrawlFailureReason(reason);
	if (parsed === undefined) return UNREADABLE_REASON_NOTICE;
	if (parsed.kind === "blocked") return NOTICE_BY_BLOCK_CAUSE[parsed.cause];
	return NOTICE_BY_FAILURE_KIND[parsed.kind];
}
