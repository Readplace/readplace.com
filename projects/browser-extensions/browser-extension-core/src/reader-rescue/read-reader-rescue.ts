import { CAPTURE_CONTROL_ATTRIBUTE, RESCUE_ID_ATTRIBUTE, RESCUE_URL_ATTRIBUTE } from "./reader-rescue-message.types";

export type OfferedRescue = { url: string; articleId: string };

type RescueNotice = { getAttribute(name: string): string | null };

export type RescueNoticeDocument = { querySelector(selectors: string): RescueNotice | null };

export type RescueTapTarget = { closest(selectors: string): RescueNotice | null };

export const RESCUE_NOTICE_SELECTOR = `[${RESCUE_URL_ATTRIBUTE}]`;
const CAPTURE_CONTROL_SELECTOR = `[${CAPTURE_CONTROL_ATTRIBUTE}]`;

function offeredBy(notice: RescueNotice | null): OfferedRescue | undefined {
	const url = notice?.getAttribute(RESCUE_URL_ATTRIBUTE);
	const articleId = notice?.getAttribute(RESCUE_ID_ATTRIBUTE);
	if (!url || !articleId) return undefined;
	return { url, articleId };
}

export function readReaderRescue(document: RescueNoticeDocument): OfferedRescue | undefined {
	return offeredBy(document.querySelector(RESCUE_NOTICE_SELECTOR));
}

export function readTappedRescue(target: RescueTapTarget): OfferedRescue | undefined {
	if (!target.closest(CAPTURE_CONTROL_SELECTOR)) return undefined;
	return offeredBy(target.closest(RESCUE_NOTICE_SELECTOR));
}
