import assert from "node:assert/strict";
import { selectGmailNewsletterNotices } from "./gmail-newsletter-notice-selection";

const candidate = (index: number, pendingSince: number | undefined) => ({ senderEmail: `news${String(index).padStart(2, "0")}@example.com`, pendingSince, label: `Letter ${index}` });

describe("selectGmailNewsletterNotices", () => {
	it("lists the ten newsletters pending longest, oldest first, and counts the rest as waiting", () => {
		const shuffled = [7, 2, 11, 0, 9, 4, 1, 10, 5, 8, 3, 6].map((index) => candidate(index, 1_000 + index * 60_000));
		assert.deepEqual(selectGmailNewsletterNotices(shuffled), {
			listed: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => candidate(index, 1_000 + index * 60_000)),
			waiting: 2,
		});
	});

	it("lists every newsletter and leaves none waiting when ten or fewer are pending", () => {
		assert.deepEqual(selectGmailNewsletterNotices([candidate(2, 3_000), candidate(0, 1_000), candidate(1, 2_000)]), {
			listed: [candidate(0, 1_000), candidate(1, 2_000), candidate(2, 3_000)],
			waiting: 0,
		});
	});

	it("lists a newsletter pending since before the pending time was recorded ahead of newer ones", () => {
		assert.deepEqual(selectGmailNewsletterNotices([candidate(0, 1_000), candidate(9, undefined), candidate(1, 2_000)]), {
			listed: [candidate(9, undefined), candidate(0, 1_000), candidate(1, 2_000)],
			waiting: 0,
		});
	});

	it("breaks ties in pending time by sender address and leaves the highest addresses waiting", () => {
		const sameInstant = Array.from({ length: 11 }, (_, index) => candidate(10 - index, 5_000));
		const { listed, waiting } = selectGmailNewsletterNotices([...sameInstant, candidate(21, undefined), candidate(20, undefined)]);
		assert.deepEqual(listed.map((selected) => selected.senderEmail), [20, 21, 0, 1, 2, 3, 4, 5, 6, 7].map((index) => candidate(index, undefined).senderEmail));
		assert.equal(waiting, 3);
	});
});
