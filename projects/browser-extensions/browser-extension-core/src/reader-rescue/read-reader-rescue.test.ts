import assert from "node:assert/strict";
import { readReaderRescue, readTappedRescue } from "./read-reader-rescue";

type Attributes = Record<string, string>;

function carriesEvery(selectors: string, attributes: Attributes): boolean {
	return selectors
		.slice(1, -1)
		.split("][")
		.every((name) => name in attributes);
}

function elementWith(attributes: Attributes) {
	return { getAttribute: (name: string) => attributes[name] ?? null };
}

function pageOf(elements: Attributes[]) {
	return {
		querySelector(selectors: string) {
			const match = elements.find((attributes) => carriesEvery(selectors, attributes));
			return match ? elementWith(match) : null;
		},
	};
}

function tapOn(ancestry: Attributes[]) {
	return {
		closest(selectors: string) {
			const match = ancestry.find((attributes) => carriesEvery(selectors, attributes));
			return match ? elementWith(match) : null;
		},
	};
}

const OFFERED_NOTICE: Attributes = {
	"data-reader-status": "blocked",
	"data-reader-rescue-url": "https://example.com/a",
	"data-reader-article-id": "article-1",
};

describe("readReaderRescue", () => {
	it("returns the rescue URL and article id the notice publishes", () => {
		assert.deepEqual(readReaderRescue(pageOf([{ "data-reader-status": "none" }, OFFERED_NOTICE])), {
			url: "https://example.com/a",
			articleId: "article-1",
		});
	});

	it("returns undefined when no notice carries them", () => {
		assert.equal(readReaderRescue(pageOf([{ "data-reader-status": "blocked" }])), undefined);
		assert.equal(
			readReaderRescue(pageOf([{ "data-reader-rescue-url": "https://example.com/a" }])),
			undefined,
		);
	});
});

describe("readTappedRescue", () => {
	it("returns the rescue of the notice whose capture control was tapped", () => {
		assert.deepEqual(
			readTappedRescue(
				tapOn([{ "data-reader-capture": "" }, { class: "article-body__reader-notice-actions" }, OFFERED_NOTICE]),
			),
			{ url: "https://example.com/a", articleId: "article-1" },
		);
	});

	it("returns undefined for a tap outside the capture control or on a notice that offers no rescue", () => {
		assert.equal(readTappedRescue(tapOn([{ href: "https://example.com/a" }, OFFERED_NOTICE])), undefined);
		assert.equal(
			readTappedRescue(tapOn([{ "data-reader-capture": "" }, { "data-reader-status": "blocked" }])),
			undefined,
		);
	});
});
