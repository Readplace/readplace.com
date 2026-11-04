import {
	type CrawlFailureReason,
	type ReaderFailedVariant,
	parseCrawlFailureReason,
} from "@packages/article-state-types";

export type CaptureRescue = "offered" | "withheld";

export interface FailedCrawlNotice {
	variant: ReaderFailedVariant;
	captureRescue: CaptureRescue;
	explanation?: string;
}

const NOTICE_BY_FAILURE_KIND = {
	"parse-error": { variant: "failed", captureRescue: "offered" },
	"capture-unreadable": { variant: "capture-unreadable", captureRescue: "offered" },
	"fetch-failed": { variant: "failed", captureRescue: "offered" },
	"exhausted-retries": { variant: "failed", captureRescue: "offered" },
	"origin-unreachable": { variant: "origin-down", captureRescue: "withheld" },
	"not-found": { variant: "not-found", captureRescue: "withheld" },
} satisfies Record<Exclude<CrawlFailureReason["kind"], "blocked" | "processing-failed">, FailedCrawlNotice>;

const NOTICE_BY_BLOCK_CAUSE = {
	"edge-block": { variant: "blocked", captureRescue: "offered" },
	"rate-limited": { variant: "blocked", captureRescue: "offered" },
	"spend-capped": { variant: "failed", captureRescue: "offered" },
	robots: { variant: "failed", captureRescue: "withheld" },
} satisfies Record<Extract<CrawlFailureReason, { kind: "blocked" }>["cause"], FailedCrawlNotice>;

const UNREADABLE_REASON_NOTICE: FailedCrawlNotice = { variant: "failed", captureRescue: "offered" };

export function failedCrawlNotice(reason: string): FailedCrawlNotice {
	const parsed = parseCrawlFailureReason(reason);
	if (parsed === undefined) return UNREADABLE_REASON_NOTICE;
	if (parsed.kind === "blocked") return NOTICE_BY_BLOCK_CAUSE[parsed.cause];
	if (parsed.kind === "processing-failed") return privateItemFailedNotice(reason);
	return NOTICE_BY_FAILURE_KIND[parsed.kind];
}

const PRIVATE_ITEM_FAILED_NOTICE: FailedCrawlNotice = { variant: "processing-failed", captureRescue: "withheld" };

export function privateItemFailedNotice(reason: string): FailedCrawlNotice {
	const parsed = parseCrawlFailureReason(reason);
	if (parsed?.kind !== "processing-failed") return PRIVATE_ITEM_FAILED_NOTICE;
	return { ...PRIVATE_ITEM_FAILED_NOTICE, explanation: parsed.notice };
}
