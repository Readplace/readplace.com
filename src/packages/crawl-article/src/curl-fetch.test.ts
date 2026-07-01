import type { ResolvePinnedAddress } from "./blocked-address-lookup";
import { type ExecCurl, CURL_IMPERSONATE_BIN, createCurlFetch } from "./curl-fetch";

/** Default fake: every host resolves to one public address (no pin needed in
 * tests that only exercise argument/response handling). */
const resolvePinnedAddress: ResolvePinnedAddress = async () => "93.184.216.34";

type ExecCall = {
	args: readonly string[];
	options: { timeoutMs: number | undefined };
};

type FakeExec = {
	execCurl: ExecCurl;
	calls: ExecCall[];
	kill: jest.Mock;
	pendingClose: () => void;
};

function makeFakeExec(opts: { stdout?: Buffer | string; error?: Error; deferCallback?: boolean } = {}): FakeExec {
	const calls: ExecCall[] = [];
	const kill = jest.fn();
	let closeListener: (() => void) | undefined;
	let pendingCallback: (() => void) | undefined;
	const execCurl: ExecCurl = (args, options, callback) => {
		calls.push({ args, options });
		const buf = typeof opts.stdout === "string" ? Buffer.from(opts.stdout) : opts.stdout ?? Buffer.alloc(0);
		const fire = () => {
			callback(opts.error ?? null, buf);
			closeListener?.();
		};
		if (opts.deferCallback) {
			pendingCallback = fire;
		} else {
			setImmediate(fire);
		}
		return {
			kill: () => {
				kill();
				closeListener?.();
			},
			onClose: (listener) => {
				closeListener = listener;
			},
		};
	};
	return {
		execCurl,
		calls,
		kill,
		pendingClose: () => pendingCallback?.(),
	};
}

describe("fetchCurl response parsing", () => {
	it("parses a simple 200 response with headers and body", async () => {
		const fake = makeFakeExec({
			stdout: "HTTP/1.1 200 OK\r\ncontent-type: text/html\r\nserver: nginx\r\n\r\n<html>hello</html>",
		});
		const fetchCurl = createCurlFetch({ execCurl: fake.execCurl, resolvePinnedAddress });
		const response = await fetchCurl("https://example.com");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("text/html");
		expect(response.headers.get("server")).toBe("nginx");
		expect(await response.text()).toBe("<html>hello</html>");
	});

	it("parses the final response after a redirect chain", async () => {
		const fake = makeFakeExec({
			stdout: [
				"HTTP/1.1 301 Moved Permanently\r\nlocation: /new-path\r\n\r\n",
				"HTTP/1.1 200 OK\r\ncontent-type: text/html\r\n\r\n<html>final</html>",
			].join(""),
		});
		const fetchCurl = createCurlFetch({ execCurl: fake.execCurl, resolvePinnedAddress });
		const response = await fetchCurl("https://example.com");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("text/html");
		expect(await response.text()).toBe("<html>final</html>");
	});

	it("parses a 403 response", async () => {
		const fake = makeFakeExec({
			stdout: "HTTP/2 403 \r\nserver: cloudflare\r\n\r\nForbidden",
		});
		const fetchCurl = createCurlFetch({ execCurl: fake.execCurl, resolvePinnedAddress });
		const response = await fetchCurl("https://example.com");
		expect(response.status).toBe(403);
		expect(response.headers.get("server")).toBe("cloudflare");
		expect(await response.text()).toBe("Forbidden");
	});

	it("handles an empty body", async () => {
		const fake = makeFakeExec({ stdout: "HTTP/1.1 204 No Content\r\n\r\n" });
		const fetchCurl = createCurlFetch({ execCurl: fake.execCurl, resolvePinnedAddress });
		const response = await fetchCurl("https://example.com");
		expect(response.status).toBe(204);
		expect(await response.text()).toBe("");
	});

	it("preserves binary body content", async () => {
		const headerPart = "HTTP/1.1 200 OK\r\ncontent-type: image/png\r\n\r\n";
		const binaryBody = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
		const fake = makeFakeExec({ stdout: Buffer.concat([Buffer.from(headerPart), binaryBody]) });
		const fetchCurl = createCurlFetch({ execCurl: fake.execCurl, resolvePinnedAddress });
		const response = await fetchCurl("https://example.com");
		expect(response.status).toBe(200);
		expect(Buffer.from(await response.arrayBuffer())).toEqual(binaryBody);
	});

	it("treats output without a header separator as headers-only with empty body", async () => {
		const fake = makeFakeExec({ stdout: "HTTP/1.1 502 Bad Gateway\r\n" });
		const fetchCurl = createCurlFetch({ execCurl: fake.execCurl, resolvePinnedAddress });
		const response = await fetchCurl("https://example.com");
		expect(response.status).toBe(502);
		expect(await response.text()).toBe("");
	});
});

describe("fetchCurl argument construction", () => {
	it("invokes curl with --http2 and the URL after a -- separator", async () => {
		const fake = makeFakeExec({ stdout: "HTTP/1.1 200 OK\r\n\r\n" });
		const fetchCurl = createCurlFetch({ execCurl: fake.execCurl, resolvePinnedAddress });
		await fetchCurl("https://example.com/page?q=1");
		const args = fake.calls[0].args;
		expect(args).toContain("--http2");
		expect(args).toContain("--compressed");
		expect(args).not.toContain("--location");
		const sepIdx = args.indexOf("--");
		expect(sepIdx).toBeGreaterThan(0);
		expect(args[sepIdx + 1]).toBe("https://example.com/page?q=1");
	});

	it("passes --globoff so bracketed URLs are not parsed as range expansions", async () => {
		const fake = makeFakeExec({ stdout: "HTTP/1.1 200 OK\r\n\r\n" });
		const fetchCurl = createCurlFetch({ execCurl: fake.execCurl, resolvePinnedAddress });
		const url = "https://www.cia.gov/readingroom/docs/COMPUTERS%20AND%20AUTOMATION%20[16505689].pdf";
		await fetchCurl(url);
		const args = fake.calls[0].args;
		expect(args).toContain("--globoff");
		const sepIdx = args.indexOf("--");
		expect(args[sepIdx + 1]).toBe(url);
	});

	it("refuses to follow redirects (--max-redirs 0) so curl can't reach an unchecked host", async () => {
		const fake = makeFakeExec({ stdout: "HTTP/1.1 200 OK\r\n\r\n" });
		const fetchCurl = createCurlFetch({ execCurl: fake.execCurl, resolvePinnedAddress });
		await fetchCurl("https://example.com/page");
		const args = fake.calls[0].args;
		expect(args[args.indexOf("--max-redirs") + 1]).toBe("0");
	});

	it("pins a named host to the resolved+checked address via --resolve", async () => {
		const fake = makeFakeExec({ stdout: "HTTP/1.1 200 OK\r\n\r\n" });
		const fetchCurl = createCurlFetch({
			execCurl: fake.execCurl,
			resolvePinnedAddress: async () => "93.184.216.34",
		});
		await fetchCurl("https://example.com/page");
		const args = fake.calls[0].args;
		expect(args[args.indexOf("--resolve") + 1]).toBe("example.com:443:93.184.216.34");
	});

	it("brackets an IPv6 pinned address in --resolve", async () => {
		const fake = makeFakeExec({ stdout: "HTTP/1.1 200 OK\r\n\r\n" });
		const fetchCurl = createCurlFetch({
			execCurl: fake.execCurl,
			resolvePinnedAddress: async () => "2606:4700:4700::1111",
		});
		await fetchCurl("https://example.com:8443/page");
		const args = fake.calls[0].args;
		expect(args[args.indexOf("--resolve") + 1]).toBe("example.com:8443:[2606:4700:4700::1111]");
	});

	it("omits --resolve for an IP-literal host (curl connects to it directly, no DNS)", async () => {
		const fake = makeFakeExec({ stdout: "HTTP/1.1 200 OK\r\n\r\n" });
		const fetchCurl = createCurlFetch({
			execCurl: fake.execCurl,
			resolvePinnedAddress: async () => "93.184.216.34",
		});
		await fetchCurl("https://93.184.216.34/page");
		expect(fake.calls[0].args).not.toContain("--resolve");
	});

	it("re-encodes a partially decoded URL (literal spaces) before passing to curl", async () => {
		const fake = makeFakeExec({ stdout: "HTTP/1.1 200 OK\r\n\r\n" });
		const fetchCurl = createCurlFetch({ execCurl: fake.execCurl, resolvePinnedAddress });
		// Some upstream paths (e.g. recrawl handlers reading a decoded path param)
		// pass URLs with literal spaces and brackets. curl rejects literal spaces
		// with "Malformed input to a URL function" (exit 3) even under --globoff.
		const decoded = "https://www.cia.gov/readingroom/docs/COMPUTERS AND AUTOMATION [16505689].pdf";
		await fetchCurl(decoded);
		const args = fake.calls[0].args;
		const sepIdx = args.indexOf("--");
		expect(args[sepIdx + 1]).toBe(
			"https://www.cia.gov/readingroom/docs/COMPUTERS%20AND%20AUTOMATION%20[16505689].pdf",
		);
	});

	it("title-cases header names per Cloudflare JA3 fingerprinting", async () => {
		const fake = makeFakeExec({ stdout: "HTTP/1.1 200 OK\r\n\r\n" });
		const fetchCurl = createCurlFetch({ execCurl: fake.execCurl, resolvePinnedAddress });
		await fetchCurl("https://example.com", {
			headers: {
				"user-agent": "Test/1.0",
				"accept-language": "en-US",
				accept: "text/html",
			},
		});
		const args = fake.calls[0].args;
		expect(args).toContain("User-Agent: Test/1.0");
		expect(args).toContain("Accept-Language: en-US");
		expect(args).toContain("Accept: text/html");
	});

	it("uses the default 10s timeout when no signal is provided", async () => {
		const fake = makeFakeExec({ stdout: "HTTP/1.1 200 OK\r\n\r\n" });
		const fetchCurl = createCurlFetch({ execCurl: fake.execCurl, resolvePinnedAddress });
		await fetchCurl("https://example.com");
		expect(fake.calls[0].options.timeoutMs).toBe(10000);
	});

	it("disables the internal timeout when a signal is provided so the caller controls timing", async () => {
		const fake = makeFakeExec({ stdout: "HTTP/1.1 200 OK\r\n\r\n" });
		const fetchCurl = createCurlFetch({ execCurl: fake.execCurl, resolvePinnedAddress });
		await fetchCurl("https://example.com", { signal: new AbortController().signal });
		expect(fake.calls[0].options.timeoutMs).toBeUndefined();
	});
});

describe("fetchCurl error handling", () => {
	it("rejects with the URL embedded in the message when curl fails", async () => {
		const fake = makeFakeExec({ error: new Error("spawn ENOENT") });
		const fetchCurl = createCurlFetch({ execCurl: fake.execCurl, resolvePinnedAddress });
		await expect(fetchCurl("https://example.com/path")).rejects.toThrow(
			/fetchCurl failed for https:\/\/example\.com\/path: spawn ENOENT/,
		);
	});
});

describe("fetchCurl abort signal handling", () => {
	it("rejects immediately and kills the child if the signal is already aborted", async () => {
		const fake = makeFakeExec({ deferCallback: true });
		const fetchCurl = createCurlFetch({ execCurl: fake.execCurl, resolvePinnedAddress });
		const controller = new AbortController();
		controller.abort(new Error("already aborted"));
		await expect(fetchCurl("https://example.com", { signal: controller.signal })).rejects.toThrow(
			"already aborted",
		);
		expect(fake.kill).toHaveBeenCalledTimes(1);
	});

	it("rejects and kills the child when the signal aborts mid-flight", async () => {
		const fake = makeFakeExec({ deferCallback: true });
		const fetchCurl = createCurlFetch({ execCurl: fake.execCurl, resolvePinnedAddress });
		const controller = new AbortController();
		const promise = fetchCurl("https://example.com", { signal: controller.signal });
		setImmediate(() => controller.abort(new Error("mid-flight abort")));
		await expect(promise).rejects.toThrow("mid-flight abort");
		expect(fake.kill).toHaveBeenCalledTimes(1);
	});

	it("removes the abort listener once the child closes so a later abort is a no-op", async () => {
		const fake = makeFakeExec({ stdout: "HTTP/1.1 200 OK\r\n\r\nbody" });
		const fetchCurl = createCurlFetch({ execCurl: fake.execCurl, resolvePinnedAddress });
		const controller = new AbortController();
		const response = await fetchCurl("https://example.com", { signal: controller.signal });
		expect(response.status).toBe(200);
		controller.abort(new Error("late abort"));
		expect(fake.kill).not.toHaveBeenCalled();
	});
});

describe("fetchCurl redirect following (SSRF-guarded per hop)", () => {
	function makeSequencedExec(stdouts: string[]): { execCurl: ExecCurl; calls: { args: readonly string[] }[] } {
		const calls: { args: readonly string[] }[] = [];
		let idx = 0;
		const execCurl: ExecCurl = (args, _options, callback) => {
			calls.push({ args });
			const buf = Buffer.from(stdouts[Math.min(idx, stdouts.length - 1)]);
			idx++;
			setImmediate(() => callback(null, buf));
			return { kill: () => {}, onClose: () => {} };
		};
		return { execCurl, calls };
	}

	it("follows a 301 to the final 200, re-validating each hop's host through the SSRF guard", async () => {
		const seq = makeSequencedExec([
			"HTTP/1.1 301 Moved Permanently\r\nlocation: https://example.com/final\r\n\r\n",
			"HTTP/1.1 200 OK\r\ncontent-type: text/html\r\n\r\n<html>final</html>",
		]);
		const resolveSpy = jest.fn(async () => "93.184.216.34");
		const fetchCurl = createCurlFetch({ execCurl: seq.execCurl, resolvePinnedAddress: resolveSpy });

		const response = await fetchCurl("https://example.com/start");

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("<html>final</html>");
		expect(seq.calls).toHaveLength(2);
		expect(resolveSpy).toHaveBeenCalledTimes(2);
	});

	it("resolves a relative Location against the current url before following", async () => {
		const seq = makeSequencedExec([
			"HTTP/1.1 302 Found\r\nlocation: /moved\r\n\r\n",
			"HTTP/1.1 200 OK\r\n\r\nok",
		]);
		const fetchCurl = createCurlFetch({ execCurl: seq.execCurl, resolvePinnedAddress });

		await fetchCurl("https://example.com/a/b");

		const secondArgs = seq.calls[1].args;
		const sepIdx = secondArgs.indexOf("--");
		expect(secondArgs[sepIdx + 1]).toBe("https://example.com/moved");
	});

	it("re-pins a cross-host redirect target through --resolve for the new host", async () => {
		const seq = makeSequencedExec([
			"HTTP/1.1 301 Moved Permanently\r\nlocation: https://other.example/dest\r\n\r\n",
			"HTTP/1.1 200 OK\r\n\r\nok",
		]);
		const resolveSpy = jest.fn(async ({ hostname }: { hostname: string }) =>
			hostname === "other.example" ? "203.0.113.9" : "93.184.216.34",
		);
		const fetchCurl = createCurlFetch({ execCurl: seq.execCurl, resolvePinnedAddress: resolveSpy });

		await fetchCurl("https://example.com/start");

		expect(resolveSpy).toHaveBeenCalledWith({ hostname: "other.example" });
		const secondArgs = seq.calls[1].args;
		expect(secondArgs[secondArgs.indexOf("--resolve") + 1]).toBe("other.example:443:203.0.113.9");
	});

	it("refuses a redirect whose target host is blocked by the SSRF guard (no curl spawned for it)", async () => {
		const seq = makeSequencedExec([
			"HTTP/1.1 301 Moved Permanently\r\nlocation: https://169.254.169.254/latest/meta-data\r\n\r\n",
			"HTTP/1.1 200 OK\r\n\r\nsecrets",
		]);
		const resolveSpy = jest.fn(async ({ hostname }: { hostname: string }) => {
			if (hostname === "169.254.169.254") throw new Error("blocked address 169.254.169.254");
			return "93.184.216.34";
		});
		const fetchCurl = createCurlFetch({ execCurl: seq.execCurl, resolvePinnedAddress: resolveSpy });

		await expect(fetchCurl("https://example.com/start")).rejects.toThrow(/blocked address/);
		expect(seq.calls).toHaveLength(1);
	});

	it("stops and fails after MAX_REDIRECTS consecutive redirects", async () => {
		const seq = makeSequencedExec([
			"HTTP/1.1 302 Found\r\nlocation: https://example.com/loop\r\n\r\n",
		]);
		const fetchCurl = createCurlFetch({ execCurl: seq.execCurl, resolvePinnedAddress });

		await expect(fetchCurl("https://example.com/start")).rejects.toThrow(/too many redirects/);
	});

	it("does not follow a non-redirect status even if a Location header is present", async () => {
		const seq = makeSequencedExec([
			"HTTP/1.1 200 OK\r\nlocation: https://example.com/elsewhere\r\n\r\nbody",
		]);
		const fetchCurl = createCurlFetch({ execCurl: seq.execCurl, resolvePinnedAddress });

		const response = await fetchCurl("https://example.com/start");

		expect(response.status).toBe(200);
		expect(seq.calls).toHaveLength(1);
	});
});

describe("createCurlFetch defaults", () => {
	it("returns a callable function with an explicit execCurl", () => {
		const fake = makeFakeExec();
		const fetchCurl = createCurlFetch({ execCurl: fake.execCurl, resolvePinnedAddress });
		expect(typeof fetchCurl).toBe("function");
	});
});

describe("CURL_IMPERSONATE_BIN", () => {
	it("is the curl-impersonate Chrome variant binary name", () => {
		expect(CURL_IMPERSONATE_BIN).toBe("curl_chrome131");
	});
});
