import { JSDOM } from "jsdom";
import {
	applyIndeterminate,
	initIndeterminateCheckboxes,
} from "./import.client";

function makeDoc(html: string): Document {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

describe("applyIndeterminate", () => {
	it("sets the indeterminate property on every checkbox carrying the marker", () => {
		const doc = makeDoc(
			'<input type="checkbox" data-import-indeterminate id="a">' +
				'<input type="checkbox" data-import-indeterminate id="b">' +
				'<input type="checkbox" id="c">',
		);

		const matched = applyIndeterminate(doc);

		expect(matched).toBe(2);
		expect(doc.querySelector<HTMLInputElement>("#a")?.indeterminate).toBe(true);
		expect(doc.querySelector<HTMLInputElement>("#b")?.indeterminate).toBe(true);
		expect(doc.querySelector<HTMLInputElement>("#c")?.indeterminate).toBe(false);
	});

	it("returns 0 when no checkbox carries the marker", () => {
		const doc = makeDoc('<input type="checkbox" id="a">');

		expect(applyIndeterminate(doc)).toBe(0);
	});
});

describe("initIndeterminateCheckboxes", () => {
	it("applies indeterminate on initial run and on every swap notification", () => {
		const doc = makeDoc('<input type="checkbox" data-import-indeterminate id="a">');
		let registered: (() => void) | undefined;

		initIndeterminateCheckboxes({
			document: doc,
			addSwapListener: (listener) => {
				registered = listener;
			},
		});

		const target = doc.querySelector<HTMLInputElement>("#a");
		expect(target?.indeterminate).toBe(true);

		// Reset to false then re-run via the swap listener and confirm it re-applies.
		if (target) target.indeterminate = false;
		registered?.();
		expect(target?.indeterminate).toBe(true);
	});
});
