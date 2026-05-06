import { buildQueueUrl, parseQueueUrl } from "./queue.url";

describe("parseQueueUrl", () => {
	it("should default to queue tab for empty query", () => {
		const state = parseQueueUrl({});
		expect(state).toEqual({ tab: "queue", order: undefined, page: 1 });
	});

	it("should parse tab parameter", () => {
		expect(parseQueueUrl({ tab: "done" }).tab).toBe("done");
		expect(parseQueueUrl({ tab: "queue" }).tab).toBe("queue");
	});

	it("should default to queue tab for invalid tab", () => {
		expect(parseQueueUrl({ tab: "invalid" }).tab).toBe("queue");
	});

	it("should map legacy status=read to done tab", () => {
		expect(parseQueueUrl({ status: "read" }).tab).toBe("done");
	});

	it("should map legacy status=unread to queue tab", () => {
		expect(parseQueueUrl({ status: "unread" }).tab).toBe("queue");
	});

	it("should prefer tab over legacy status when both present", () => {
		expect(parseQueueUrl({ tab: "queue", status: "read" }).tab).toBe("queue");
	});

	it("should default to queue tab for invalid legacy status", () => {
		expect(parseQueueUrl({ status: "invalid" }).tab).toBe("queue");
	});

	it("should parse order", () => {
		expect(parseQueueUrl({ order: "asc" }).order).toBe("asc");
		expect(parseQueueUrl({ order: "desc" }).order).toBe("desc");
	});

	it("should return undefined for invalid order", () => {
		expect(parseQueueUrl({ order: "invalid" }).order).toBeUndefined();
	});

	it("should parse page number", () => {
		expect(parseQueueUrl({ page: "3" }).page).toBe(3);
	});

	it("should default to page 1 for invalid page", () => {
		expect(parseQueueUrl({ page: "-1" }).page).toBe(1);
		expect(parseQueueUrl({ page: "abc" }).page).toBe(1);
		expect(parseQueueUrl({ page: "0" }).page).toBe(1);
	});

});

describe("buildQueueUrl", () => {
	it("should return /queue for defaults", () => {
		expect(buildQueueUrl({})).toBe("/queue");
	});

	it("should omit default tab (queue)", () => {
		expect(buildQueueUrl({ tab: "queue" })).toBe("/queue");
	});

	it("should include non-default tab", () => {
		expect(buildQueueUrl({ tab: "done" })).toBe("/queue?tab=done");
	});

	it("should omit order matching tab defaultOrder", () => {
		expect(buildQueueUrl({ order: "desc" })).toBe("/queue");
		expect(buildQueueUrl({ tab: "done", order: "desc" })).toBe("/queue?tab=done");
	});

	it("should include order differing from tab defaultOrder", () => {
		expect(buildQueueUrl({ order: "asc" })).toBe("/queue?order=asc");
		expect(buildQueueUrl({ tab: "done", order: "asc" })).toBe("/queue?tab=done&order=asc");
	});

	it("should omit page 1", () => {
		expect(buildQueueUrl({ page: 1 })).toBe("/queue");
	});

	it("should include page > 1", () => {
		expect(buildQueueUrl({ page: 2 })).toBe("/queue?page=2");
	});

	it("should combine multiple params", () => {
		const url = buildQueueUrl({ tab: "done", order: "asc", page: 3 });
		expect(url).toContain("tab=done");
		expect(url).toContain("order=asc");
		expect(url).toContain("page=3");
	});

});
