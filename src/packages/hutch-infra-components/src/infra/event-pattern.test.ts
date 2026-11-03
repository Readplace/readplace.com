import assert from "node:assert/strict";
import { eventPatternFor } from "./event-pattern";

describe("eventPatternFor", () => {
	it("renders the source and detail type alone when no detail filter is given", () => {
		const pattern = eventPatternFor({
			source: "hutch.save-link",
			detailType: "LinkSaved",
		});

		assert.equal(
			pattern,
			'{"source":["hutch.save-link"],"detail-type":["LinkSaved"]}',
		);
	});

	it("renders a literal filter as an EventBridge content filter", () => {
		const pattern = eventPatternFor({
			source: "hutch.media",
			detailType: "MediaUploadCommitted",
			detail: { kind: ["book"] },
		});

		assert.equal(
			pattern,
			'{"source":["hutch.media"],"detail-type":["MediaUploadCommitted"],"detail":{"kind":["book"]}}',
		);
	});

	it("renders a prefix filter as an EventBridge content filter", () => {
		const pattern = eventPatternFor({
			source: "hutch.api",
			detailType: "LinkDequeued",
			detail: { url: [{ prefix: "https://uploads.readplace.invalid/" }] },
		});

		assert.equal(
			pattern,
			'{"source":["hutch.api"],"detail-type":["LinkDequeued"],"detail":{"url":[{"prefix":"https://uploads.readplace.invalid/"}]}}',
		);
	});
});
