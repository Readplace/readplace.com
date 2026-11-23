import { z } from "zod";
import type { CollectedFailedRow } from "./collect-failed-rows";
import type { FailureHistoryMembership } from "./failure-history-memberships";
import type { FailureHistoryLogMatch } from "./failure-history-logs";
import type { FailedArticlesIssueRow } from "./failed-articles-issue";

const TIMESTAMP = z.iso.datetime({ offset: true });

function timestamp(value: string | undefined): number | undefined {
	const parsed = TIMESTAMP.safeParse(value);
	return parsed.success ? Date.parse(parsed.data) : undefined;
}

function canVerifyNoReaderStamp(input: {
	memberships: readonly FailureHistoryMembership[];
	saved: number;
	admitted: number;
	cutoff: number;
}): boolean {
	let membershipAtAdmission = false;
	for (const membership of input.memberships) {
		const saved = timestamp(membership.savedAt);
		const viewed = timestamp(membership.viewedAt);
		if (saved === undefined || saved > input.cutoff) return false;
		if (saved <= input.admitted) membershipAtAdmission = true;
		if (membership.viewedAt === undefined) continue;
		if (viewed === undefined || viewed < saved || viewed > input.cutoff) return false;
		if (viewed >= input.saved) return false;
	}
	return membershipAtAdmission;
}

export function classifyFailureHistory(input: {
	row: CollectedFailedRow;
	cutoff: Date;
	logs: FailureHistoryLogMatch | undefined;
	memberships: readonly FailureHistoryMembership[] | undefined;
	publicOpenRecorded: boolean;
	publicOpensCovered: boolean;
}): FailedArticlesIssueRow {
	const { row, logs, memberships } = input;
	const unknown: FailedArticlesIssueRow = { ...row, historyGroup: "other-unknown" };
	const saved = timestamp(row.savedAt);
	const admitted = timestamp(row.fullCrawlRequestedAt);
	const cutoff = input.cutoff.getTime();
	if (saved === undefined || admitted === undefined || saved > admitted || admitted > cutoff) return unknown;

	const ownerOpens = logs?.ownerOpenTimes.filter((time) => time >= saved && time <= cutoff) ?? [];
	const surface = logs?.admissionCovered && timestamp(row.resolutionOnViewClaimedAt) === admitted
		? logs.admissionSurface : undefined;
	if (
		surface === "reader" || surface === "reader-capture-gave-up" ||
		ownerOpens.some((time) => time < admitted)
	) {
		return { ...row, historyGroup: "reader-opened-before-failure" };
	}

	if (input.publicOpenRecorded) {
		return logs?.ownerOpensCovered && ownerOpens.length === 0
			? { ...unknown, publicReaderOnlyBeforeFailure: true }
			: unknown;
	}

	if (
		(surface === "readlist-html" || surface === "readlist-siren") &&
		logs?.ownerOpensCovered && input.publicOpensCovered && ownerOpens.length === 0 && memberships &&
		canVerifyNoReaderStamp({ memberships, saved, admitted, cutoff })
	) {
		return { ...row, historyGroup: "readlist-loaded-no-reader-open" };
	}

	return unknown;
}
