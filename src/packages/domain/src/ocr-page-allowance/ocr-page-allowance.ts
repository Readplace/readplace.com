import type { RateLimitRule } from "../rate-limit";

export interface OcrPageSlot {
	slotStart: number;
	pages: number;
}

const SLOT_SECONDS = 3600;

export const OCR_PAGE_QUOTA_RULE: RateLimitRule = {
	limit: 98,
	windowSeconds: 86_400,
};

function slotFreesAtSeconds(slot: OcrPageSlot): number {
	return slot.slotStart + SLOT_SECONDS + OCR_PAGE_QUOTA_RULE.windowSeconds;
}

function liveSlots(params: {
	slots: readonly OcrPageSlot[];
	nowMs: number;
}): OcrPageSlot[] {
	const nowSeconds = params.nowMs / 1000;
	return params.slots
		.filter((slot) => slotFreesAtSeconds(slot) > nowSeconds)
		.sort((a, b) => a.slotStart - b.slotStart);
}

function pagesUsed(slots: readonly OcrPageSlot[]): number {
	return slots.reduce((sum, slot) => sum + slot.pages, 0);
}

export function pagesLeftInWindow(params: {
	slots: readonly OcrPageSlot[];
	nowMs: number;
}): number {
	const used = pagesUsed(liveSlots(params));
	return Math.max(0, OCR_PAGE_QUOTA_RULE.limit - used);
}

export function addPagesToSlots(params: {
	slots: readonly OcrPageSlot[];
	nowMs: number;
	pages: number;
}): OcrPageSlot[] {
	const nowSeconds = Math.floor(params.nowMs / 1000);
	const currentSlotStart = nowSeconds - (nowSeconds % SLOT_SECONDS);
	const kept = liveSlots(params).filter(
		(slot) => slot.slotStart !== currentSlotStart,
	);
	const current = params.slots.find(
		(slot) => slot.slotStart === currentSlotStart,
	);
	const currentPages = current ? current.pages : 0;
	return [
		...kept,
		{ slotStart: currentSlotStart, pages: currentPages + params.pages },
	];
}

export function retryAtFor(params: {
	slots: readonly OcrPageSlot[];
	nowMs: number;
	pages: number;
}): Date {
	const { limit } = OCR_PAGE_QUOTA_RULE;
	const live = liveSlots(params);
	const needed = Math.min(params.pages, limit);
	let used = pagesUsed(live);
	if (limit - used >= params.pages) return new Date(params.nowMs);
	for (const slot of live) {
		used -= slot.pages;
		if (limit - used >= needed || params.pages > limit) {
			return new Date(slotFreesAtSeconds(slot) * 1000);
		}
	}
	return new Date(params.nowMs + OCR_PAGE_QUOTA_RULE.windowSeconds * 1000);
}
