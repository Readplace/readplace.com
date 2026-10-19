import type { HutchLogger } from "@packages/hutch-logger";
import type { CaptureTrigger } from "../reading-list/reading-list.types";
import {
	type OfferedRescue,
	type RescueNoticeDocument,
	type RescueTapTarget,
	readReaderRescue,
	readTappedRescue,
} from "./read-reader-rescue";
import {
	CAPTURE_HOST_ATTRIBUTE,
	READER_RESCUE_MESSAGE_TYPE,
	type ReaderRescueRequest,
	ReaderRescueAnswerSchema,
	ReaderRescueEndedSchema,
} from "./reader-rescue-message.types";

export type CaptureHostDocument = RescueNoticeDocument & {
	documentElement: { setAttribute(name: string, value: string): void };
};

export function initCaptureHost(deps: {
	document: CaptureHostDocument;
	requestRescue: (request: ReaderRescueRequest) => Promise<unknown>;
	announceCaptureStarted: () => void;
	announceCaptureFailed: () => void;
	logger: HutchLogger;
}): {
	pageChanged: () => Promise<void>;
	tapped: (target: RescueTapTarget) => Promise<void>;
	rescueEnded: (raw: unknown) => void;
} {
	const askedArticleIds = new Set<string>();
	const requestedArticleIds = new Set<string>();

	function request(params: { rescue: OfferedRescue; trigger: CaptureTrigger }): Promise<unknown> {
		requestedArticleIds.add(params.rescue.articleId);
		return deps
			.requestRescue({
				type: READER_RESCUE_MESSAGE_TYPE,
				url: params.rescue.url,
				articleId: params.rescue.articleId,
				trigger: params.trigger,
			})
			.catch((error: unknown) => {
				deps.logger.warn("[reader-rescue] the extension did not answer the rescue request", error);
				return undefined;
			});
	}

	function hostTheCapture(raw: unknown): void {
		const answer = ReaderRescueAnswerSchema.safeParse(raw);
		if (!answer.success) return;
		if (answer.data.outcome === "skipped" && answer.data.reason === "not-logged-in") return;
		deps.document.documentElement.setAttribute(CAPTURE_HOST_ATTRIBUTE, "");
		if (answer.data.outcome === "started") deps.announceCaptureStarted();
	}

	return {
		async pageChanged() {
			const rescue = readReaderRescue(deps.document);
			if (!rescue || askedArticleIds.has(rescue.articleId)) return;
			askedArticleIds.add(rescue.articleId);
			hostTheCapture(await request({ rescue, trigger: "automatic" }));
		},

		async tapped(target) {
			const rescue = readTappedRescue(target);
			if (!rescue) return;
			const answer = ReaderRescueAnswerSchema.safeParse(await request({ rescue, trigger: "manual" }));
			if (answer.success && answer.data.outcome === "started") return;
			deps.announceCaptureFailed();
		},

		rescueEnded(raw) {
			const ended = ReaderRescueEndedSchema.safeParse(raw);
			if (!ended.success || !requestedArticleIds.has(ended.data.articleId)) return;
			deps.announceCaptureFailed();
		},
	};
}
