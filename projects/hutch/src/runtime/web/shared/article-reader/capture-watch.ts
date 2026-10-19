import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import { MAX_CAPTURE_POLLS } from "@packages/web-shell";
import { z } from "zod";

export type CaptureWatch =
	| { kind: "none" }
	| { kind: "started"; noticeRevision: number }
	| { kind: "watching"; since: number }
	| { kind: "device-gave-up"; since: number };

export type CaptureResolution =
	| { kind: "none" }
	| { kind: "carry"; watch: CaptureWatch }
	| { kind: "copying"; since: number }
	| { kind: "missing" };

export const NO_CAPTURE_WATCH: CaptureWatch = { kind: "none" };

const RevisionParam = z.string().regex(/^\d+$/).transform(Number);
const FlagParam = z.literal("1");

export function captureWatchQuery(watch: CaptureWatch): string {
	switch (watch.kind) {
		case "none":
			return "";
		case "started":
			return `&captureNotice=${watch.noticeRevision}`;
		case "watching":
			return `&captureSince=${watch.since}`;
		case "device-gave-up":
			return `&captureSince=${watch.since}&captureGaveUp=1`;
	}
}

export function parseCaptureWatch(query: Record<string, unknown>): CaptureWatch {
	const since = RevisionParam.safeParse(query.captureSince);
	if (since.success) {
		return FlagParam.safeParse(query.captureGaveUp).success
			? { kind: "device-gave-up", since: since.data }
			: { kind: "watching", since: since.data };
	}
	const noticeRevision = RevisionParam.safeParse(query.captureNotice);
	if (noticeRevision.success) return { kind: "started", noticeRevision: noticeRevision.data };
	if (FlagParam.safeParse(query.capturing).success) return { kind: "watching", since: 0 };
	return NO_CAPTURE_WATCH;
}

export function resolveCaptureWatch(params: {
	watch: CaptureWatch;
	crawl: ArticleCrawl | undefined;
	pollCount: number;
}): CaptureResolution {
	const { watch, crawl } = params;
	if (watch.kind === "none") return { kind: "none" };
	if (crawl?.status === "ready" || crawl?.status === "unsupported") return { kind: "none" };
	if (crawl === undefined || crawl.status === "pending") {
		return {
			kind: "carry",
			watch: watch.kind === "started" ? { kind: "watching", since: watch.noticeRevision } : watch,
		};
	}
	const since =
		watch.kind === "started" ? Math.max(watch.noticeRevision, crawl.outcomeRevision) : watch.since;
	if (crawl.outcomeRevision > since) return { kind: "none" };
	if (watch.kind === "device-gave-up") return { kind: "missing" };
	if (params.pollCount >= MAX_CAPTURE_POLLS) return { kind: "missing" };
	return { kind: "copying", since };
}
