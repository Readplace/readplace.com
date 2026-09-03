import { MAX_HTML_BYTES } from "./html-body-limit";

describe("MAX_HTML_BYTES", () => {
	it("locks the cap to the largest body whose measured ~80x parse peak still fits the 3008 MB Lambda ceiling", () => {
		expect(MAX_HTML_BYTES.bytes).toBe(28 * 1024 * 1024);
	});

	it("exposes a human-readable label for log lines", () => {
		expect(MAX_HTML_BYTES.label).toBe("28 MB");
	});
});
