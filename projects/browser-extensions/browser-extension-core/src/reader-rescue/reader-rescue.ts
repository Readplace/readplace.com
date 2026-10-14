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
	logger: HutchLogger;
}): (request: RescueRequest) => Promise<{ answer: ReaderRescueAnswer; completion: Promise<void> }> {
	async function rescue(request: RescueRequest): Promise<void> {
		try {
			const result = await deps.capture({ url: request.url, openerTabId: request.openerTabId });
			if (result.kind === "no-capture") {
				deps.logger.info(`[reader-rescue] nothing to upload for ${request.url}: ${result.reason}`);
				return;
			}
			await deps.enqueueCaptured({
				url: request.url,
				title: result.title,
				content: result.content,
				trigger: request.trigger,
			});
		} catch (error) {
			deps.logger.error(`[reader-rescue] the rescue of ${request.url} failed`, error);
		}
	}

	return async (request) => {
		if (request.trigger === "automatic" && (await deps.attempts.claim(request.articleId)) === "repeat") {
			return { answer: { outcome: "skipped", reason: "already-attempted" }, completion: Promise.resolve() };
		}
		return { answer: { outcome: "started" }, completion: rescue(request) };
	};
}
