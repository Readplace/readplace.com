import type tls from "node:tls";
import {
	aiaUrlFromCert,
	derOrPemToPem,
	initFetchAia,
	isTlsChainError,
	type PrimaryFetch,
	withAiaChasing,
} from "./aia-fetch";

describe("isTlsChainError", () => {
	it("returns true for fetch failures caused by UNABLE_TO_VERIFY_LEAF_SIGNATURE", () => {
		const cause = Object.assign(new Error("leaf signature"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
		const error = Object.assign(new TypeError("fetch failed"), { cause });
		expect(isTlsChainError(error)).toBe(true);
	});

	it("returns true for UNABLE_TO_GET_ISSUER_CERT_LOCALLY", () => {
		const error = Object.assign(new Error("x"), { code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" });
		expect(isTlsChainError(error)).toBe(true);
	});

	it("returns true for UNABLE_TO_GET_ISSUER_CERT", () => {
		const error = Object.assign(new Error("x"), { code: "UNABLE_TO_GET_ISSUER_CERT" });
		expect(isTlsChainError(error)).toBe(true);
	});

	it("returns true for CERT_UNTRUSTED", () => {
		const error = Object.assign(new Error("x"), { code: "CERT_UNTRUSTED" });
		expect(isTlsChainError(error)).toBe(true);
	});

	it("returns false for a fetch failure with a non-TLS cause", () => {
		const cause = Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" });
		const error = Object.assign(new TypeError("fetch failed"), { cause });
		expect(isTlsChainError(error)).toBe(false);
	});

	it("returns false for an error without a code", () => {
		expect(isTlsChainError(new Error("no code"))).toBe(false);
	});

	it("returns false for non-Error values", () => {
		expect(isTlsChainError(null)).toBe(false);
		expect(isTlsChainError("oops")).toBe(false);
		expect(isTlsChainError(undefined)).toBe(false);
	});

	it("returns false when cause is not an Error but outer has no relevant code", () => {
		const error = Object.assign(new Error("x"), { cause: "string cause" });
		expect(isTlsChainError(error)).toBe(false);
	});
});

describe("aiaUrlFromCert", () => {
	it("returns the first CA Issuers URI from infoAccess", () => {
		const cert = {
			infoAccess: { "CA Issuers - URI": ["http://ca.example/intermediate.crt"] },
		} as unknown as tls.PeerCertificate;
		expect(aiaUrlFromCert(cert)).toBe("http://ca.example/intermediate.crt");
	});

	it("returns null when cert is null", () => {
		expect(aiaUrlFromCert(null)).toBeNull();
	});

	it("returns null when infoAccess is missing", () => {
		const cert = { subject: { CN: "x" } } as unknown as tls.PeerCertificate;
		expect(aiaUrlFromCert(cert)).toBeNull();
	});

	it("returns null when CA Issuers URI is missing", () => {
		const cert = { infoAccess: { "OCSP - URI": ["http://ocsp"] } } as unknown as tls.PeerCertificate;
		expect(aiaUrlFromCert(cert)).toBeNull();
	});

	it("returns null when CA Issuers URI array is empty", () => {
		const cert = { infoAccess: { "CA Issuers - URI": [] } } as unknown as tls.PeerCertificate;
		expect(aiaUrlFromCert(cert)).toBeNull();
	});
});

describe("derOrPemToPem", () => {
	it("returns existing PEM content unchanged", () => {
		const pem = "-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----\n";
		expect(derOrPemToPem(Buffer.from(pem, "ascii"))).toBe(pem);
	});

	it("wraps DER bytes as base64 PEM", () => {
		const der = Buffer.from([0x30, 0x82, 0x01, 0x00, 0x02, 0x03, 0x04]);
		const pem = derOrPemToPem(der);
		expect(pem.startsWith("-----BEGIN CERTIFICATE-----\n")).toBe(true);
		expect(pem.endsWith("\n-----END CERTIFICATE-----\n")).toBe(true);
		expect(pem).toContain(der.toString("base64"));
	});

	it("wraps long DER bytes at 64-char boundaries", () => {
		const der = Buffer.alloc(200, 0xaa);
		const pem = derOrPemToPem(der);
		const lines = pem.split("\n").filter((l) => !l.startsWith("-----") && l.length > 0);
		expect(lines.every((l) => l.length <= 64)).toBe(true);
	});
});

describe("withAiaChasing", () => {
	type FetchAia = ReturnType<typeof initFetchAia>;
	const live = () => new AbortController().signal;
	const request = (headers: Record<string, string> = {}) => ({ headers, signal: live() });

	it("passes responses through unchanged when baseFetch succeeds", async () => {
		const baseFetch: PrimaryFetch = async () => new Response("ok", { status: 200 });
		const fetchAia = jest.fn<ReturnType<FetchAia>, Parameters<FetchAia>>();
		const wrapped = withAiaChasing(baseFetch, fetchAia);

		const response = await wrapped("https://example.com", request());

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("ok");
		expect(fetchAia).not.toHaveBeenCalled();
	});

	it("rethrows non-TLS errors without calling fetchAia", async () => {
		const baseFetch: PrimaryFetch = async () => {
			throw new Error("network boom");
		};
		const fetchAia = jest.fn<ReturnType<FetchAia>, Parameters<FetchAia>>();
		const wrapped = withAiaChasing(baseFetch, fetchAia);

		await expect(wrapped("https://example.com", request())).rejects.toThrow("network boom");
		expect(fetchAia).not.toHaveBeenCalled();
	});

	it("retries via fetchAia on a TLS chain error, carrying the caller's headers and deadline", async () => {
		const baseFetch: PrimaryFetch = async () => {
			const cause = Object.assign(new Error("leaf"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
			throw Object.assign(new TypeError("fetch failed"), { cause });
		};
		const fetchAia = jest.fn<ReturnType<FetchAia>, Parameters<FetchAia>>(async () => new Response("recovered"));
		const wrapped = withAiaChasing(baseFetch, fetchAia);
		const init = request({ "user-agent": "T" });

		const response = await wrapped("https://example.com/a?b=1", init);

		expect(await response.text()).toBe("recovered");
		expect(fetchAia).toHaveBeenCalledWith("https://example.com/a?b=1", {
			headers: { "user-agent": "T" },
			signal: init.signal,
		});
	});

	it("defaults to the real fetchAia implementation when no override is given", () => {
		const baseFetch: PrimaryFetch = async () => new Response("ok");
		expect(typeof withAiaChasing(baseFetch)).toBe("function");
	});
});

describe("initFetchAia", () => {
	const leafCert = {
		infoAccess: { "CA Issuers - URI": ["http://ca.example/intermediate.crt"] },
	} as unknown as tls.PeerCertificate;
	const intermediateDer = Buffer.from([0x30, 0x82, 0x01, 0x00]);

	function makeDeps(overrides: Partial<Parameters<typeof initFetchAia>[0]> = {}) {
		return {
			fetchPeerCertificate: jest.fn(async () => leafCert),
			downloadIssuerBytes: jest.fn(async () => intermediateDer),
			httpsGet: jest.fn(),
			...overrides,
		};
	}

	it("returns a Response for a 200 from the first hop", async () => {
		const deps = makeDeps({
			httpsGet: jest.fn(async () => ({ status: 200, headers: { "content-type": "text/html" }, body: Buffer.from("<html>ok</html>") })),
		});
		const fetchAia = initFetchAia(deps);

		const response = await fetchAia("https://example.com/x");

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("text/html");
		expect(await response.text()).toBe("<html>ok</html>");
		expect(deps.fetchPeerCertificate).not.toHaveBeenCalled();
	});

	it("follows redirects to the final destination", async () => {
		let calls = 0;
		const deps = makeDeps({
			httpsGet: jest.fn(async ({ url }) => {
				calls++;
				if (url.pathname === "/start") {
					return { status: 301, headers: { location: "/final" }, body: Buffer.alloc(0) };
				}
				return { status: 200, headers: {}, body: Buffer.from("end") };
			}),
		});
		const fetchAia = initFetchAia(deps);

		const response = await fetchAia("https://example.com/start");

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("end");
		expect(calls).toBe(2);
	});

	// The followRedirects edge cases are owned by follow-redirects.test.ts; these
	// drive the same cross-cutting behaviors through the real fetchAia so a future
	// change to its wiring of the shared loop (resolving against the origin, handing
	// headers straight to httpsGet, skipping the scheme allowlist) fails here too.
	it("resolves a path-relative Location against the current hop's directory, not the origin", async () => {
		const seen: string[] = [];
		const deps = makeDeps({
			httpsGet: jest.fn(async ({ url }) => {
				seen.push(url.href);
				if (url.pathname === "/current/path") {
					return { status: 302, headers: { location: "sub/page" }, body: Buffer.alloc(0) };
				}
				return { status: 200, headers: {}, body: Buffer.from("landed") };
			}),
		});
		const fetchAia = initFetchAia(deps);

		const response = await fetchAia("https://example.com/current/path");

		expect(await response.text()).toBe("landed");
		expect(seen).toEqual(["https://example.com/current/path", "https://example.com/current/sub/page"]);
	});

	it("drops cookie/authorization but keeps other headers when a redirect crosses origins", async () => {
		const headersSeen: Array<Record<string, string> | undefined> = [];
		const deps = makeDeps({
			httpsGet: jest.fn(async ({ url, headers }) => {
				headersSeen.push(headers);
				if (url.origin === "https://example.com") {
					return { status: 301, headers: { location: "https://other.example/dest" }, body: Buffer.alloc(0) };
				}
				return { status: 200, headers: {}, body: Buffer.from("dest") };
			}),
		});
		const fetchAia = initFetchAia(deps);

		await fetchAia("https://example.com/start", {
			headers: { cookie: "s=secret", authorization: "Bearer t", "user-agent": "Persona/1.0" },
		});

		expect(headersSeen[0]).toEqual({ cookie: "s=secret", authorization: "Bearer t", "user-agent": "Persona/1.0" });
		expect(headersSeen[1]).toEqual({ "user-agent": "Persona/1.0" });
	});

	it("refuses to follow a redirect to a non-HTTP(S) scheme", async () => {
		const deps = makeDeps({
			httpsGet: jest.fn(async () => ({
				status: 301,
				headers: { location: "gopher://127.0.0.1:70/1payload" },
				body: Buffer.alloc(0),
			})),
		});
		const fetchAia = initFetchAia(deps);

		await expect(fetchAia("https://example.com/start")).rejects.toThrow(
			/fetchAia failed for .*: refusing to follow redirect to non-HTTP\(S\) scheme "gopher:"/,
		);
		expect(deps.httpsGet).toHaveBeenCalledTimes(1);
	});

	it("joins multi-value response headers with a comma", async () => {
		const deps = makeDeps({
			httpsGet: jest.fn(async () => ({ status: 200, headers: { "set-cookie": ["a=1", "b=2"] }, body: Buffer.alloc(0) })),
		});
		const fetchAia = initFetchAia(deps);

		const response = await fetchAia("https://example.com/");

		expect(response.headers.get("set-cookie")).toBe("a=1, b=2");
	});

	it("fetches the intermediate and retries when the first hop returns a TLS chain error", async () => {
		let firstCall = true;
		const deps = makeDeps({
			httpsGet: jest.fn(async () => {
				if (firstCall) {
					firstCall = false;
					const cause = Object.assign(new Error("leaf"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
					throw cause;
				}
				return { status: 200, headers: {}, body: Buffer.from("fixed") };
			}),
		});
		const fetchAia = initFetchAia(deps);

		const response = await fetchAia("https://example.com/");

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("fixed");
		expect(deps.fetchPeerCertificate).toHaveBeenCalledTimes(1);
		expect(deps.downloadIssuerBytes).toHaveBeenCalledWith("http://ca.example/intermediate.crt", undefined);
	});

	it("rethrows non-TLS errors from httpsGet", async () => {
		const deps = makeDeps({
			httpsGet: jest.fn(async () => {
				throw new Error("ECONNREFUSED");
			}),
		});
		const fetchAia = initFetchAia(deps);

		await expect(fetchAia("https://example.com/")).rejects.toThrow("ECONNREFUSED");
	});

	it("throws when the leaf cert has no AIA URL", async () => {
		const deps = makeDeps({
			fetchPeerCertificate: jest.fn(async () => null),
			httpsGet: jest.fn(async () => {
				throw Object.assign(new Error("x"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
			}),
		});
		const fetchAia = initFetchAia(deps);

		await expect(fetchAia("https://example.com/")).rejects.toThrow(/AIA URL/);
	});

	it("returns a redirect without a location header as the final response (WHATWG fetch semantics)", async () => {
		const httpsGet = jest.fn(async () => ({ status: 301, headers: {}, body: Buffer.alloc(0) }));
		const deps = makeDeps({ httpsGet });
		const fetchAia = initFetchAia(deps);

		const response = await fetchAia("https://example.com/");

		expect(response.status).toBe(301);
		expect(httpsGet).toHaveBeenCalledTimes(1);
	});

	it("throws after more than MAX_REDIRECTS consecutive redirects", async () => {
		const deps = makeDeps({
			httpsGet: jest.fn(async () => ({ status: 302, headers: { location: "/loop" }, body: Buffer.alloc(0) })),
		});
		const fetchAia = initFetchAia(deps);

		await expect(fetchAia("https://example.com/loop")).rejects.toThrow(/too many redirects/);
	});

	it("threads init headers/signal and assertHostAllowed through the AIA-retry path", async () => {
		const assertHostAllowed = jest.fn();
		let firstCall = true;
		const deps = makeDeps({
			assertHostAllowed,
			httpsGet: jest.fn(async () => {
				if (firstCall) {
					firstCall = false;
					throw Object.assign(new Error("leaf"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
				}
				return { status: 200, headers: {}, body: Buffer.from("ok") };
			}),
		});
		const fetchAia = initFetchAia(deps);
		const signal = AbortSignal.timeout(5000);

		const response = await fetchAia("https://example.com/x", {
			headers: { "user-agent": "Test/1.0" },
			signal,
		});

		expect(response.status).toBe(200);
		expect(assertHostAllowed).toHaveBeenCalledWith("example.com");
		// Both the direct and the AIA-retry httpsGet calls carry the caller's init.
		expect(deps.httpsGet).toHaveBeenCalledWith(
			expect.objectContaining({ headers: { "user-agent": "Test/1.0" }, signal }),
		);
		expect(deps.httpsGet).toHaveBeenCalledTimes(2);
		// The TLS cert probe and the intermediate download inherit the caller's signal.
		expect(deps.fetchPeerCertificate).toHaveBeenCalledWith(expect.objectContaining({ signal }));
		expect(deps.downloadIssuerBytes).toHaveBeenCalledWith("http://ca.example/intermediate.crt", signal);
	});

	it("reuses a cached intermediate on a subsequent request to the same host", async () => {
		let firstCall = true;
		const deps = makeDeps({
			httpsGet: jest.fn(async () => {
				if (firstCall) {
					firstCall = false;
					throw Object.assign(new Error("leaf"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
				}
				return { status: 200, headers: {}, body: Buffer.from("ok") };
			}),
		});
		const fetchAia = initFetchAia(deps);

		await fetchAia("https://example.com/one");
		await fetchAia("https://example.com/two");

		// fetchPeerCertificate and downloadIssuerBytes should only be called once
		// thanks to the per-host intermediate cache.
		expect(deps.fetchPeerCertificate).toHaveBeenCalledTimes(1);
		expect(deps.downloadIssuerBytes).toHaveBeenCalledTimes(1);
	});
});
