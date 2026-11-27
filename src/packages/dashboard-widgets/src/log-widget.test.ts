import assert from "node:assert/strict";
import { logWidget } from "./log-widget";

describe("logWidget", () => {
	it("prefixes the query with one SOURCE clause per log group", () => {
		const widget = logWidget({
			region: "ap-southeast-2",
			title: "Saves",
			logGroupNames: ["group-a", "group-b"],
			query: "fields @timestamp",
			view: "table",
			x: 0,
			y: 4,
			width: 12,
			height: 6,
		});

		assert.deepEqual(widget, {
			type: "log",
			x: 0,
			y: 4,
			width: 12,
			height: 6,
			properties: {
				region: "ap-southeast-2",
				title: "Saves",
				query: "SOURCE 'group-a' | SOURCE 'group-b' | fields @timestamp",
				view: "table",
			},
		});
	});
});
