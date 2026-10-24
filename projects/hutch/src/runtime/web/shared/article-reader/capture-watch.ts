import { type CaptureTrigger, CaptureTriggerSchema } from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import { MAX_CAPTURE_POLLS } from "@packages/web-shell";
import { z } from "zod";

export type CaptureWatch =
	| { kind: "none" }
	| { kind: "started"; noticeRevision: number; trigger: CaptureTrigger }
	| { kind: "watching"; since: number; trigger: CaptureTrigger }
	| { kind: "device-gave-up"; since: number; trigger: CaptureTrigger };

export type CaptureResolution =
	| { kind: "none" }
	| { kind: "carry"; watch: CaptureWatch }
	| { kind: "copying"; since: number; trigger: CaptureTrigger }
	| { kind: "missing" };

export const NO_CAPTURE_WATCH: CaptureWatch = { kind: "none" };

const RevisionParam = z.string().regex(/^\d+$/).transform(Number);
const FlagParam = z.literal("1");
const TriggerParam = CaptureTriggerSchema.catch("manual");

const ENDED_WITHOUT_A_COPY: Readonly<Record<CaptureTrigger, CaptureResolution>> = {
	manual: { kind: "missing" },
	automatic: { kind: "none" },
};

function watchQuery(watch: Exclude<CaptureWatch, { kind: "none" }>): string {
	switch (watch.kind) {
		case "started":
			return `&captureNotice=${watch.noticeRevision}`;
		case "watching":
			return `&captureSince=${watch.since}`;
		case "device-gave-up":
			return `&captureSince=${watch.since}&captureGaveUp=1`;
	}
}

export function captureWatchQuery(watch: CaptureWatch): string {
	return watch.kind === "none" ? "" : `${watchQuery(watch)}&captureTrigger=${watch.trigger}`;
}

export function parseCaptureWatch(query: Record<string, unknown>): CaptureWatch {
	const trigger = TriggerParam.parse(query.captureTrigger);
	const since = RevisionParam.safeParse(query.captureSince);
	if (since.success) {
		return FlagParam.safeParse(query.captureGaveUp).success
			? { kind: "device-gave-up", since: since.data, trigger }
			: { kind: "watching", since: since.data, trigger };
	}
	const noticeRevision = RevisionParam.safeParse(query.captureNotice);
	if (noticeRevision.success) return { kind: "started", noticeRevision: noticeRevision.data, trigger };
	if (FlagParam.safeParse(query.capturing).success) return { kind: "watching", since: 0, trigger };
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
			watch:
				watch.kind === "started"
					? { kind: "watching", since: watch.noticeRevision, trigger: watch.trigger }
					: watch,
		};
	}
	const since =
		watch.kind === "started" ? Math.max(watch.noticeRevision, crawl.outcomeRevision) : watch.since;
	if (crawl.outcomeRevision > since) return { kind: "none" };
	if (watch.kind === "device-gave-up") return ENDED_WITHOUT_A_COPY[watch.trigger];
	if (params.pollCount >= MAX_CAPTURE_POLLS) return ENDED_WITHOUT_A_COPY[watch.trigger];
	return { kind: "copying", since, trigger: watch.trigger };
}
