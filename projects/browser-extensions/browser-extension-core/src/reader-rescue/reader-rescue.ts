import type { HutchLogger } from "@packages/hutch-logger";
import type { CaptureTrigger } from "../reading-list/reading-list.types";
import type { UploadQueue } from "../upload-queue/upload-queue.types";
import type { ReaderRescueAnswer } from "./reader-rescue-message.types";
import type { RescueAttempts } from "./rescue-attempts";
import type { RescueCapture } from "./rescue-capture";

type RescueRequest = { url: string; articleId: string; trigger: CaptureTrigger; openerTabId?: number };

export function initReaderRescue(deps: {
	attempts: RescueAttempts;
	capture: RescueCapture;
	enqueueCaptured: UploadQueue["enqueueCaptured"];
	tellOpenerNothingCopied: (params: { articleId: string; openerTabId: number }) => Promise<unknown>;
	logger: HutchLogger;
}): (request: RescueRequest) => Promise<{ answer: ReaderRescueAnswer; completion: Promise<void> }> {
	async function copy(request: RescueRequest): Promise<"copied" | "nothing-copied"> {
		try {
			const result = await deps.capture({ url: request.url, openerTabId: request.openerTabId });
			if (result.kind === "no-capture") {
				deps.logger.info(`[reader-rescue] nothing to upload for ${request.url}: ${result.reason}`);
				return "nothing-copied";
			}
			await deps.enqueueCaptured({
				url: request.url,
				title: result.title,
				content: result.content,
				trigger: request.trigger,
			});
			return "copied";
		} catch (error) {
			deps.logger.error(`[reader-rescue] the rescue of ${request.url} failed`, error);
			return "nothing-copied";
		}
	}

	async function rescue(request: RescueRequest): Promise<void> {
		const outcome = await copy(request);
		if (outcome === "copied" || request.openerTabId === undefined) return;
		await deps
			.tellOpenerNothingCopied({ articleId: request.articleId, openerTabId: request.openerTabId })
			.catch((error: unknown) => {
				deps.logger.debug(`[reader-rescue] the opener tab of ${request.url} did not hear that nothing was copied`, error);
			});
	}

	return async (request) => {
		if (request.trigger === "automatic" && (await deps.attempts.claim(request.articleId)) === "repeat") {
			return { answer: { outcome: "skipped", reason: "already-attempted" }, completion: Promise.resolve() };
		}
		return { answer: { outcome: "started" }, completion: rescue(request) };
	};
}
