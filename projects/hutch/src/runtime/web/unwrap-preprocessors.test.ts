import {
	MAX_SAVEABLE_URL_LENGTH,
	type SaveableUrlResult,
	type ValidateSaveableUrl,
} from "@packages/domain/article";
import {
	type UnwrapContext,
	type UnwrapPreprocessor,
	unwrappedPreProcessors,
	withUnwrapPreprocessing,
} from "./unwrap-preprocessors";

const CONTEXT: UnwrapContext = { selfHost: "readplace.com" };

/** Peels one `<key>:` prefix per application, so it strictly shrinks and is a
 * noop once its prefix is gone. */
function stripPrefix(key: string): UnwrapPreprocessor {
	const prefix = `${key}:`;
	return (url) => (url.startsWith(prefix) ? url.slice(prefix.length) : url);
}

function captureValidator(): { validate: ValidateSaveableUrl; seen: () => unknown } {
	let received: unknown;
	const validate: ValidateSaveableUrl = (value) => {
		received = value;
		return { status: "ERROR", error: { code: "malformed_url", message: "stub" } };
	};
	return { validate, seen: () => received };
}

describe("unwrappedPreProcessors — composition", () => {
	it("applies a single preprocessor", () => {
		const unwrap = unwrappedPreProcessors(stripPrefix("a"));
		expect(unwrap("a:real", CONTEXT)).toBe("real");
	});

	it("returns the URL unchanged when no preprocessor matches", () => {
		const unwrap = unwrappedPreProcessors(stripPrefix("a"), stripPrefix("b"));
		expect(unwrap("real", CONTEXT)).toBe("real");
	});

	it("re-runs the whole set until a fixpoint, collapsing cross-provider nesting", () => {
		const unwrap = unwrappedPreProcessors(stripPrefix("a"), stripPrefix("b"));
		expect(unwrap("a:b:a:real", CONTEXT)).toBe("real");
	});

	it("threads the context through to each preprocessor", () => {
		const useSelfHost: UnwrapPreprocessor = (url, { selfHost }) =>
			url === "wrapper" ? selfHost : url;
		const unwrap = unwrappedPreProcessors(useSelfHost);
		expect(unwrap("wrapper", { selfHost: "host.example" })).toBe("host.example");
	});

	it("is a noop with no preprocessors", () => {
		const unwrap = unwrappedPreProcessors();
		expect(unwrap("https://example.com/x", CONTEXT)).toBe("https://example.com/x");
	});
});

describe("withUnwrapPreprocessing — validator decorator", () => {
	const rewriteToSentinel: UnwrapPreprocessor = () => "REWRITTEN";

	it("unwraps the value before handing it to the wrapped validator", () => {
		const { validate, seen } = captureValidator();
		const rewriteIn: UnwrapPreprocessor = (url) => (url === "in" ? "out" : url);
		withUnwrapPreprocessing(validate, rewriteIn, CONTEXT)("in");
		expect(seen()).toBe("out");
	});

	it("passes non-string input straight through to the wrapped validator", () => {
		const { validate, seen } = captureValidator();
		withUnwrapPreprocessing(validate, rewriteToSentinel, CONTEXT)(42);
		expect(seen()).toBe(42);
	});

	it("passes an over-length string through unrewritten so validation rejects it", () => {
		const { validate, seen } = captureValidator();
		const oversized = "a".repeat(MAX_SAVEABLE_URL_LENGTH + 1);
		withUnwrapPreprocessing(validate, rewriteToSentinel, CONTEXT)(oversized);
		expect(seen()).toBe(oversized);
	});

	it("trims before measuring length, so a whitespace-padded over-length self-URL is still unwrapped", () => {
		const { validate, seen } = captureValidator();
		const selfUrl = "https://readplace.com/view/example.com/article";
		const padded = `${selfUrl}${" ".repeat(MAX_SAVEABLE_URL_LENGTH)}`;
		expect(padded.length).toBeGreaterThan(MAX_SAVEABLE_URL_LENGTH);
		const unwrapSelfUrl: UnwrapPreprocessor = (url) =>
			url === selfUrl ? "https://example.com/article" : url;
		withUnwrapPreprocessing(validate, unwrapSelfUrl, CONTEXT)(padded);
		expect(seen()).toBe("https://example.com/article");
	});

	it("returns the wrapped validator's result", () => {
		const result: SaveableUrlResult = {
			status: "ERROR",
			error: { code: "private_network", message: "sentinel" },
		};
		const validate: ValidateSaveableUrl = () => result;
		expect(
			withUnwrapPreprocessing(validate, rewriteToSentinel, CONTEXT)("https://example.com/x"),
		).toBe(result);
	});
});
