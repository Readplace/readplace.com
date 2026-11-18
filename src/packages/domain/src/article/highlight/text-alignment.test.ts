import assert from "node:assert/strict";
import {
	alignTokens,
	longestChain,
	lowerBound,
	mapSpan,
} from "./text-alignment";

describe("lowerBound", () => {
	it("finds the first position not below the value", () => {
		assert.equal(lowerBound([1, 3, 5], 3), 1);
		assert.equal(lowerBound([1, 3, 5], 6), 3);
		assert.equal(lowerBound([], 1), 0);
	});
});

describe("longestChain", () => {
	it("keeps the longest run of pairs in order on both sides", () => {
		assert.deepEqual(longestChain([]), []);
		assert.deepEqual(
			longestChain([
				[0, 2],
				[1, 0],
				[2, 1],
				[3, 3],
			]),
			[
				[1, 0],
				[2, 1],
				[3, 3],
			],
		);
	});
});

describe("alignTokens", () => {
	function align(params: {
		a: number[];
		b: number[];
		region: { aLow: number; aHigh: number; bLow: number; bHigh: number };
	}) {
		const imageOf = new Array<number>(params.a.length).fill(-1);
		alignTokens({ a: params.a, b: params.b, imageOf, stack: [params.region] });
		return imageOf;
	}

	it("pairs runs of two tokens when no single token is unique", () => {
		assert.deepEqual(
			align({
				a: [1, 1, 2, 2],
				b: [2, 2, 1, 1, 2, 2],
				region: { aLow: 0, aHigh: 4, bLow: 0, bHigh: 6 },
			}),
			[2, 3, 4, 5],
		);
	});

	it("matches a region that opens both versions from its end", () => {
		assert.deepEqual(
			align({
				a: [7, 1, 2, 9],
				b: [8, 1, 2],
				region: { aLow: 0, aHigh: 3, bLow: 0, bHigh: 3 },
			}),
			[-1, 1, 2, -1],
		);
	});

	it("leaves tokens unmatched when nothing pairs", () => {
		assert.deepEqual(
			align({
				a: [1, 1],
				b: [2, 2],
				region: { aLow: 0, aHigh: 2, bLow: 0, bHigh: 2 },
			}),
			[-1, -1],
		);
	});
});

describe("mapSpan", () => {
	const basisTokens = { starts: [0, 3, 6], ends: [2, 5, 8], keys: [0, 1, 2] };
	const textTokens = { starts: [0, 3, 6], ends: [2, 5, 8], keys: [0, 3, 2] };
	const carry = (
		imageOf: number[],
		span: { start: number; end: number },
		text = textTokens,
	) => mapSpan({ basisTokens, textTokens: text, imageOf, span });

	it("places an unmatched token at the gap between its matched neighbours", () => {
		assert.deepEqual(carry([0, -1, 2], { start: 3, end: 5 }), {
			start: 3,
			end: 5,
		});
		assert.deepEqual(carry([-1, -1, -1], { start: 0, end: 8 }), {
			start: 0,
			end: 8,
		});
		assert.equal(
			carry(
				[0, -1, 1],
				{ start: 3, end: 5 },
				{ starts: [0, 3], ends: [2, 5], keys: [0, 2] },
			),
			null,
		);
	});

	it("widens an edge whose token was not matched towards the gap", () => {
		assert.deepEqual(carry([0, -1, 2], { start: 3, end: 8 }), {
			start: 3,
			end: 8,
		});
		assert.deepEqual(carry([0, -1, 2], { start: 0, end: 5 }), {
			start: 0,
			end: 5,
		});
		assert.deepEqual(carry([0, 1, 2], { start: 2, end: 5 }), {
			start: 3,
			end: 5,
		});
	});

	it("carries nothing for a span between tokens or one that collapses", () => {
		assert.equal(carry([0, 1, 2], { start: 2, end: 3 }), null);
		assert.equal(carry([0, 0, 2], { start: 3, end: 3 }), null);
		assert.equal(
			carry(
				[0, 1, 2],
				{ start: 1, end: 2 },
				{ starts: [0, 3, 6], ends: [1, 5, 8], keys: [0, 1, 2] },
			),
			null,
		);
	});
});
