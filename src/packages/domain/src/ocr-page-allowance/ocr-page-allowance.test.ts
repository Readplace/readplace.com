import assert from "node:assert/strict";
import {
	addPagesToSlots,
	OCR_PAGE_QUOTA_RULE,
	type OcrPageSlot,
	pagesLeftInWindow,
	retryAtFor,
} from "./ocr-page-allowance";

const HOUR = 3600;
const DAY = 86_400;
const LIMIT = OCR_PAGE_QUOTA_RULE.limit;
const BASE_SECONDS = 1_800_000_000;

describe("OCR_PAGE_QUOTA_RULE", () => {
	it("allows 98 pages per 24 hours", () => {
		assert.deepEqual(OCR_PAGE_QUOTA_RULE, { limit: 98, windowSeconds: DAY });
	});
});

describe("pagesLeftInWindow", () => {
	it("leaves the whole allowance when nothing was charged", () => {
		assert.equal(
			pagesLeftInWindow({
				slots: [],
				nowMs: BASE_SECONDS * 1000,
				limit: LIMIT,
			}),
			98,
		);
	});

	it("leaves one page after 97 pages were charged", () => {
		const slots: OcrPageSlot[] = [{ slotStart: BASE_SECONDS, pages: 97 }];
		assert.equal(
			pagesLeftInWindow({
				slots,
				nowMs: (BASE_SECONDS + 60) * 1000,
				limit: LIMIT,
			}),
			1,
		);
	});

	it("drops a slot that ended exactly 24 hours ago", () => {
		const slots: OcrPageSlot[] = [{ slotStart: BASE_SECONDS, pages: 50 }];
		const nowMs = (BASE_SECONDS + HOUR + DAY) * 1000;
		assert.equal(pagesLeftInWindow({ slots, nowMs, limit: LIMIT }), 98);
	});

	it("still counts a slot that ended 23 hours 59 minutes ago", () => {
		const slots: OcrPageSlot[] = [{ slotStart: BASE_SECONDS, pages: 50 }];
		const nowMs = (BASE_SECONDS + HOUR + DAY - 60) * 1000;
		assert.equal(pagesLeftInWindow({ slots, nowMs, limit: LIMIT }), 48);
	});

	it("never reports fewer than zero pages left", () => {
		const slots: OcrPageSlot[] = [{ slotStart: BASE_SECONDS, pages: 120 }];
		assert.equal(
			pagesLeftInWindow({ slots, nowMs: BASE_SECONDS * 1000, limit: LIMIT }),
			0,
		);
	});
});

describe("addPagesToSlots", () => {
	it("opens an hour-aligned slot for the current hour", () => {
		const nowMs = (BASE_SECONDS + 125) * 1000;
		assert.deepEqual(addPagesToSlots({ slots: [], nowMs, pages: 7 }), [
			{ slotStart: BASE_SECONDS - (BASE_SECONDS % HOUR), pages: 7 },
		]);
	});

	it("adds to the current hour's slot and drops expired slots", () => {
		const hourStart = BASE_SECONDS - (BASE_SECONDS % HOUR);
		const slots: OcrPageSlot[] = [
			{ slotStart: hourStart - DAY - HOUR, pages: 30 },
			{ slotStart: hourStart - HOUR, pages: 5 },
			{ slotStart: hourStart, pages: 2 },
		];
		assert.deepEqual(
			addPagesToSlots({ slots, nowMs: (hourStart + 10) * 1000, pages: 3 }),
			[
				{ slotStart: hourStart - HOUR, pages: 5 },
				{ slotStart: hourStart, pages: 5 },
			],
		);
	});
});

describe("retryAtFor", () => {
	const hourStart = BASE_SECONDS - (BASE_SECONDS % HOUR);

	it("returns the first slot boundary where enough pages age out", () => {
		const slots: OcrPageSlot[] = [
			{ slotStart: hourStart - 5 * HOUR, pages: 10 },
			{ slotStart: hourStart - 3 * HOUR, pages: 30 },
			{ slotStart: hourStart - HOUR, pages: 28 },
		];
		const nowMs = (hourStart + 60) * 1000;
		assert.equal(pagesLeftInWindow({ slots, nowMs, limit: LIMIT }), 30);
		const retryAt = retryAtFor({ slots, nowMs, limit: LIMIT, pages: 60 });
		assert.equal(retryAt.getTime(), (hourStart - 3 * HOUR + HOUR + DAY) * 1000);
	});

	it("returns the next boundary where any page frees for a file over the limit", () => {
		const slots: OcrPageSlot[] = [
			{ slotStart: hourStart - 2 * HOUR, pages: 10 },
			{ slotStart: hourStart - 6 * HOUR, pages: 4 },
		];
		const nowMs = (hourStart + 60) * 1000;
		const retryAt = retryAtFor({ slots, nowMs, limit: LIMIT, pages: 150 });
		assert.equal(retryAt.getTime(), (hourStart - 6 * HOUR + HOUR + DAY) * 1000);
	});

	it("returns a full window from now for a file over the limit when nothing was charged", () => {
		const nowMs = (hourStart + 60) * 1000;
		const retryAt = retryAtFor({ slots: [], nowMs, limit: LIMIT, pages: 150 });
		assert.equal(retryAt.getTime(), nowMs + DAY * 1000);
	});

	it("returns now when the pages already fit", () => {
		const nowMs = (hourStart + 60) * 1000;
		const retryAt = retryAtFor({ slots: [], nowMs, limit: LIMIT, pages: 20 });
		assert.equal(retryAt.getTime(), nowMs);
	});
});

describe("allowance invariant", () => {
	it("never lets more than the limit be charged inside any real 24-hour span", () => {
		let seed = 42;
		const random = () => {
			seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
			return seed / 2_147_483_648;
		};
		let slots: OcrPageSlot[] = [];
		const charges: { atSeconds: number; pages: number }[] = [];
		let nowSeconds = BASE_SECONDS;
		for (let i = 0; i < 2_000; i++) {
			nowSeconds += Math.floor(random() * 3 * HOUR);
			const pages = 1 + Math.floor(random() * 40);
			const nowMs = nowSeconds * 1000;
			if (pagesLeftInWindow({ slots, nowMs, limit: LIMIT }) >= pages) {
				slots = addPagesToSlots({ slots, nowMs, pages });
				charges.push({ atSeconds: nowSeconds, pages });
			}
		}
		assert.ok(charges.length > 100);
		for (const start of charges) {
			const inSpan = charges
				.filter(
					(charge) =>
						charge.atSeconds >= start.atSeconds &&
						charge.atSeconds < start.atSeconds + DAY,
				)
				.reduce((sum, charge) => sum + charge.pages, 0);
			assert.ok(inSpan <= LIMIT, `span from ${start.atSeconds} held ${inSpan}`);
		}
	});
});
