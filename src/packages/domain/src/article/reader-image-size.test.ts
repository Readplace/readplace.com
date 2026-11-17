import { formatReaderImageSize, isReaderImageBoxStyle, readerImageBox } from "./reader-image-size";

describe("formatReaderImageSize", () => {
	it.each([
		[{ width: 1456, height: 1005 }, "1456x1005"],
		[{ width: 1456, height: 1005, sourceSize: "100vw" }, "1456x1005 100vw"],
		[{ width: 1024, height: 683, sourceSize: "600px" }, "1024x683 600px"],
		[{ width: 1024, height: 683, sourceSize: "min(100vw,1024px)" }, "1024x683 min(100vw,1024px)"],
	])("writes %j as %s", (size, expected) => {
		expect(formatReaderImageSize(size)).toBe(expected);
	});

	it.each([
		{ width: 0, height: 5 },
		{ width: 10, height: 0 },
		{ width: 10.5, height: 5 },
		{ width: 100000, height: 5 },
		{ width: 10, height: 5, sourceSize: "calc(100vw - 2em)" },
	])("refuses %j", (size) => {
		expect(formatReaderImageSize(size)).toBeUndefined();
	});
});

describe("readerImageBox", () => {
	it.each([
		["1456x1005", "--reader-image-width:1456px;--reader-image-ratio:1456 / 1005"],
		["1456x1005 100vw", "--reader-image-width:100vw;--reader-image-ratio:1456 / 1005"],
		["1024x683 600px", "--reader-image-width:600px;--reader-image-ratio:1024 / 683"],
		["1024x683 min(100vw,1024px)", "--reader-image-width:min(100vw,1024px);--reader-image-ratio:1024 / 683"],
	])("turns %s into its box", (stored, style) => {
		expect(readerImageBox(stored)).toEqual({ attribute: stored, style });
	});

	it.each([undefined, "", "1456 1005", "0x5", "10x5;position:fixed", " 10x5", "10x5 "])("refuses %j", (stored) => {
		expect(readerImageBox(stored)).toBeUndefined();
	});
});

describe("isReaderImageBoxStyle", () => {
	it.each(["1456x1005", "1456x1005 100vw", "1024x683 600px", "1024x683 min(100vw,1024px)"])(
		"accepts the style written for %s",
		(stored) => {
			expect(isReaderImageBoxStyle(readerImageBox(stored)?.style ?? null)).toBe(true);
		},
	);

	it.each([null, "width:5px", "--reader-image-width:1456px;--reader-image-ratio:1456 / 1005;position:fixed"])(
		"refuses %j",
		(style) => {
			expect(isReaderImageBoxStyle(style)).toBe(false);
		},
	);
});
