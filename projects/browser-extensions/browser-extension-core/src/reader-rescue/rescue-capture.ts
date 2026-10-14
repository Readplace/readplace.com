import type { HutchLogger } from "@packages/hutch-logger";
import type { TabContent } from "../reading-list/reading-list.types";
import type { HiddenTab, OpenHiddenTab, Timers } from "./hidden-tab";

export type RescueCaptureResult =
	| { kind: "captured"; content: TabContent; title: string }
	| { kind: "no-capture"; reason: "timeout" | "closed" | "unreadable" | "blocked-status" };

export type RescueCapture = (params: { url: string; openerTabId?: number }) => Promise<RescueCaptureResult>;

function isRefusedStatus(responseStatus: number | undefined): boolean {
	return responseStatus !== undefined && (responseStatus < 200 || responseStatus > 299);
}

function htmlContent(rawHtml: string): TabContent {
	return { bytes: new TextEncoder().encode(rawHtml).buffer, mediaType: "text/html" };
}

export function initRescueCapture(deps: {
	openHiddenTab: OpenHiddenTab;
	timers: Timers;
	loadTimeoutMs: number;
	logger: HutchLogger;
}): RescueCapture {
	async function waitForArticle(params: {
		tab: HiddenTab;
		url: string;
		deadline: Promise<"timeout">;
		refusedStatus?: number;
	}): Promise<RescueCaptureResult> {
		const load = await Promise.race([params.tab.nextLoad(), params.deadline]);
		if (load === "timeout") {
			return { kind: "no-capture", reason: params.refusedStatus === undefined ? "timeout" : "blocked-status" };
		}
		if (load === "removed") return { kind: "no-capture", reason: "closed" };
		const answer = await params.tab.captureHtml();
		if (!answer?.rawHtml) return { kind: "no-capture", reason: "unreadable" };
		if (!isRefusedStatus(answer.responseStatus)) {
			return { kind: "captured", content: htmlContent(answer.rawHtml), title: answer.title };
		}
		deps.logger.info(`[reader-rescue] ${params.url} answered ${answer.responseStatus}, waiting for the next load`);
		return waitForArticle({ ...params, refusedStatus: answer.responseStatus });
	}

	return async (params) => {
		const tab = await deps.openHiddenTab(params);
		try {
			return await waitForArticle({ tab, url: params.url, deadline: deps.timers.after(deps.loadTimeoutMs) });
		} finally {
			await tab.close().catch((error: unknown) => {
				deps.logger.debug(`[reader-rescue] the hidden tab for ${params.url} was already closed`, error);
			});
		}
	};
}
