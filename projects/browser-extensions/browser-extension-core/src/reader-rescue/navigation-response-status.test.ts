import assert from "node:assert/strict";
import { navigationResponseStatus } from "./navigation-response-status";

function timelineOf(navigationEntries: { entryType: string; responseStatus?: number }[]) {
	return {
		getEntriesByType: (type: string) => (type === "navigation" ? navigationEntries : []),
	};
}

describe("navigationResponseStatus", () => {
	it("reads the navigation entry's status", () => {
		assert.equal(navigationResponseStatus(timelineOf([{ entryType: "navigation", responseStatus: 200 }])), 200);
		assert.equal(navigationResponseStatus(timelineOf([{ entryType: "navigation", responseStatus: 429 }])), 429);
	});

	it("is undefined when the entry is missing, the property absent, or 0", () => {
		assert.equal(navigationResponseStatus(timelineOf([])), undefined);
		assert.equal(navigationResponseStatus(timelineOf([{ entryType: "navigation" }])), undefined);
		assert.equal(navigationResponseStatus(timelineOf([{ entryType: "navigation", responseStatus: 0 }])), undefined);
	});
});
