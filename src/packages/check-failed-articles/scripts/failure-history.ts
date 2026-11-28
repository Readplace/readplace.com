import { createHash } from "node:crypto";
import { z } from "zod";
import type { CollectedFailedRow } from "./collect-failed-rows";
import type { FailureHistoryLogMatch } from "./failure-history-logs";
import type { FailedArticlesIssueRow } from "./failed-articles-issue";
import type { ReviewedAccessCategory } from "./reviewed-access";

const TIMESTAMP = z.iso.datetime({ offset: true });

function timestamp(value: string | undefined): number | undefined {
	const parsed = TIMESTAMP.safeParse(value);
	return parsed.success ? Date.parse(parsed.data) : undefined;
}

export function classifyFailureHistory(input: {
	row: CollectedFailedRow;
	cutoff: Date;
	logs: FailureHistoryLogMatch | undefined;
	publicOpenRecorded: boolean;
	reviewedAccess: ReadonlyMap<string, ReviewedAccessCategory>;
}): FailedArticlesIssueRow {
	const { row, logs } = input;
	const unknown: FailedArticlesIssueRow = { ...row, historyGroup: "other-unknown" };
	const saved = timestamp(row.savedAt);
	const admitted = timestamp(row.fullCrawlRequestedAt);
	const cutoff = input.cutoff.getTime();
	if (saved === undefined || admitted === undefined || saved > admitted || admitted > cutoff) return unknown;

	const attemptDigest = createHash("sha256")
		.update(JSON.stringify([row.articleKey, row.savedAt, row.fullCrawlRequestedAt]), "utf8")
		.digest("hex");
	const reviewedAccess = input.reviewedAccess.get(attemptDigest);
	const publicOpen = input.publicOpenRecorded || reviewedAccess === "public-reader-opened-before-failure";
	const ownerOpens = logs?.ownerOpenTimes.filter((time) => time >= saved && time <= cutoff) ?? [];
	const surface = logs?.admissionCovered && timestamp(row.resolutionOnViewClaimedAt) === admitted
		? logs.admissionSurface : undefined;
	if (
		reviewedAccess === "signed-in-reader-opened-before-failure" ||
		surface === "reader" || surface === "reader-capture-gave-up" ||
		ownerOpens.some((time) => time < admitted)
	) {
		return {
			...row,
			historyGroup: "reader-opened-before-failure",
			readerRoutes: publicOpen ? ["signed-in", "public"] : ["signed-in"],
		};
	}

	if (publicOpen) {
		return { ...row, historyGroup: "reader-opened-before-failure", readerRoutes: ["public"] };
	}

	if (
		surface === "readlist-html" || surface === "readlist-siren" ||
		reviewedAccess === "readlist-admission-reader-history-incomplete"
	) {
		return { ...row, historyGroup: "readlist-admission-no-reader-open" };
	}

	return reviewedAccess === undefined ? unknown : { ...row, historyGroup: reviewedAccess };
}
