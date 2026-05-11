import assert from "node:assert/strict";
import {
	SaveableUrlSchema,
	saveableUrlCodeFromIssues,
	saveableUrlErrorMessage,
	validateSaveableUrl,
	type SaveableUrlErrorCode,
} from "./saveable-url";

function assertErrorCode(value: unknown, code: SaveableUrlErrorCode): void {
	const result = validateSaveableUrl(value);
	assert.equal(result.status, "ERROR", `expected ERROR for ${JSON.stringify(value)}`);
	assert(result.status === "ERROR");
	assert.equal(
		result.error.code,
		code,
		`expected ${code} for ${JSON.stringify(value)} got ${result.error.code}`,
	);
}

function assertSuccess(value: string): void {
	const result = validateSaveableUrl(value);
	assert.equal(result.status, "SUCCESS", `expected SUCCESS for ${value}`);
}

describe("validateSaveableUrl", () => {
	describe("sub-type 1 — unsupported scheme", () => {
		const cases = [
			"chrome://extensions/",
			"chrome://newtab/",
			"about:home",
			"about:newtab",
			"about:blank",
			"file:///tmp/x.html",
			"javascript:alert(1)",
			"data:text/html,<h1>x</h1>",
			"moz-extension://abc/page.html",
			"ftp://example.com/file",
			"mailto:user@example.com",
			"tel:+15551234567",
		];

		for (const url of cases) {
			it(`rejects ${url} with unsupported_scheme`, () => {
				assertErrorCode(url, "unsupported_scheme");
			});
		}
	});

	describe("sub-type 2 — private-network hostnames", () => {
		const cases = [
			"http://localhost/",
			"http://localhost:3000/api",
			"http://machine.local/",
			"http://router.home.arpa/",
			"https://my-printer.lan/",
			"https://wiki.internal/",
			"http://127.0.0.1/",
			"http://127.5.6.7/",
			"http://10.0.0.1/",
			"http://10.255.255.254/",
			"http://192.168.1.1/",
			"http://172.16.0.1/",
			"http://172.31.255.255/",
			"http://169.254.169.254/",
			"http://0.0.0.0/",
			"http://[::1]/",
			"http://[fe80::1]/",
			"http://[fc00::1]/",
			"http://[fd00::abcd]/",
			"http://[::ffff:127.0.0.1]/",
			"http://[::ffff:169.254.169.254]/",
			"http://[::ffff:192.168.1.1]/",
			"http://[::ffff:10.0.0.1]/",
		];

		for (const url of cases) {
			it(`rejects ${url} with private_network`, () => {
				assertErrorCode(url, "private_network");
			});
		}
	});

	describe("sub-type 3 — malformed URLs", () => {
		it("rejects empty string", () => {
			assertErrorCode("", "malformed_url");
		});

		it("rejects whitespace-only", () => {
			assertErrorCode("   ", "malformed_url");
		});

		it("rejects non-URL text", () => {
			assertErrorCode("not-a-url", "malformed_url");
		});

		it("rejects URL with no TLD", () => {
			assertErrorCode("https://example/", "malformed_url");
		});

		it("rejects URL with bare hostname", () => {
			assertErrorCode("https://server/", "malformed_url");
		});

		it("rejects URL with consecutive dots", () => {
			assertErrorCode("https://example..com/", "malformed_url");
		});

		it("rejects URL with trailing dots beyond a single FQDN dot", () => {
			assertErrorCode("https://example.com..../", "malformed_url");
		});

		it("rejects non-string input", () => {
			assertErrorCode(42, "malformed_url");
			assertErrorCode(undefined, "malformed_url");
			assertErrorCode(null, "malformed_url");
			assertErrorCode({}, "malformed_url");
		});
	});

	describe("happy path", () => {
		it("accepts http URL", () => {
			assertSuccess("http://example.com/article");
		});

		it("accepts https URL", () => {
			assertSuccess("https://example.com/article");
		});

		it("accepts URL with query string and utm_* params", () => {
			assertSuccess("https://example.com/post?utm_source=twitter&utm_medium=social");
		});

		it("accepts URL with fragment", () => {
			assertSuccess("https://example.com/post#section-2");
		});

		it("accepts a bare-domain URL with empty path", () => {
			assertSuccess("https://example.com");
		});

		it("accepts a public IPv4 address", () => {
			assertSuccess("http://8.8.8.8/some-page");
		});

		it("accepts a public IPv6 address", () => {
			assertSuccess("http://[2001:4860:4860::8888]/");
		});

		it("accepts an IPv4-mapped IPv6 representation of a public IPv4 address", () => {
			assertSuccess("http://[::ffff:8.8.8.8]/");
		});

		it("accepts a trailing-dot FQDN", () => {
			assertSuccess("https://example.com./");
		});

		it("accepts a punycode/IDN domain via URL canonicalisation", () => {
			assertSuccess("https://例え.テスト/");
		});

		it("accepts URLs that decode to unsafe schemes (no redirect-follow at intake)", () => {
			assertSuccess("https://example.com/redirect?to=javascript:alert(1)");
		});

		it("accepts URLs with userinfo (canonicalised by URL)", () => {
			assertSuccess("https://user:pass@example.com/post");
		});

		it("returns the canonicalised URL string", () => {
			const result = validateSaveableUrl("HTTPS://Example.COM/article");
			assert(result.status === "SUCCESS");
			assert.equal(result.url, "https://example.com/article");
		});
	});

	describe("legacy canary exclude patterns (the ones intake should now block)", () => {
		const cases: Array<[string, SaveableUrlErrorCode]> = [
			["chrome://settings", "unsupported_scheme"],
			["about:home", "unsupported_scheme"],
			["about:newtab", "unsupported_scheme"],
			["http://localhost:3000/queue", "private_network"],
		];

		for (const [url, code] of cases) {
			it(`${url} → ${code}`, () => {
				assertErrorCode(url, code);
			});
		}
	});
});

describe("SaveableUrlSchema (Zod integration)", () => {
	it("parses a valid URL into its branded form", () => {
		const parsed = SaveableUrlSchema.safeParse("https://example.com/article");
		assert(parsed.success);
		expect(parsed.data).toBe("https://example.com/article");
	});

	it("attaches the saveable-url error code to issue params", () => {
		const parsed = SaveableUrlSchema.safeParse("chrome://newtab/");
		assert(!parsed.success);
		expect(saveableUrlCodeFromIssues(parsed.error.issues)).toBe("unsupported_scheme");
	});

	it("returns the malformed_url code on a non-URL", () => {
		const parsed = SaveableUrlSchema.safeParse("not-a-url");
		assert(!parsed.success);
		expect(saveableUrlCodeFromIssues(parsed.error.issues)).toBe("malformed_url");
	});

	it("returns the private_network code on localhost", () => {
		const parsed = SaveableUrlSchema.safeParse("http://localhost/page");
		assert(!parsed.success);
		expect(saveableUrlCodeFromIssues(parsed.error.issues)).toBe("private_network");
	});

	it("returns undefined when issues contain no saveable-url custom params", () => {
		expect(saveableUrlCodeFromIssues([])).toBeUndefined();
	});

	it("returns the error message from the issue", () => {
		const parsed = SaveableUrlSchema.safeParse("chrome://newtab/");
		assert(!parsed.success);
		expect(parsed.error.issues[0]?.message).toBe(
			saveableUrlErrorMessage("unsupported_scheme"),
		);
	});
});

describe("saveableUrlErrorMessage", () => {
	it("returns a stable message for each code", () => {
		expect(saveableUrlErrorMessage("malformed_url")).toMatch(/valid URL/);
		expect(saveableUrlErrorMessage("unsupported_scheme")).toMatch(/http/);
		expect(saveableUrlErrorMessage("private_network")).toMatch(/[Pp]rivate-network/);
	});
});
