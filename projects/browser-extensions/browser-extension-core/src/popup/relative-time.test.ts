import assert from "node:assert/strict";
import { relativeTime } from "./relative-time";

describe("relativeTime", () => {
	it("returns 'just now' for dates less than 60 seconds ago", () => {
		assert.equal(relativeTime(new Date()), "just now");
	});

	it("returns minutes for dates less than an hour ago", () => {
		const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
		assert.equal(relativeTime(fiveMinutesAgo), "5m ago");
	});

	it("returns hours for dates less than a day ago", () => {
		const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
		assert.equal(relativeTime(threeHoursAgo), "3h ago");
	});

	it("returns 'Yesterday' for dates one day ago", () => {
		const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
		assert.equal(relativeTime(yesterday), "Yesterday");
	});

	it("returns days for dates less than 30 days ago", () => {
		const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
		assert.equal(relativeTime(tenDaysAgo), "10d ago");
	});

	it("returns months for dates less than a year ago", () => {
		const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
		assert.equal(relativeTime(threeMonthsAgo), "3mo ago");
	});

	it("returns years for dates more than a year ago", () => {
		const twoYearsAgo = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000);
		assert.equal(relativeTime(twoYearsAgo), "2y ago");
	});
});
