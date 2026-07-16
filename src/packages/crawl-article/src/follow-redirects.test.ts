import { redirectable, type RedirectableFetch } from "./follow-redirects";

type Call = { url: string; headers: Record<string, string> | undefined };

function makeBase(responses: Response[]): { baseFetch: RedirectableFetch; calls: Call[] } {
	const calls: Call[] = [];
	let index = 0;
	const baseFetch: RedirectableFetch = async (url, init) => {
		calls.push({ url, headers: init?.headers });
		const response = responses[Math.min(index, responses.length - 1)];
		index++;
		return response;
	};
	return { baseFetch, calls };
}

function redirect(status: number, location: string): Response {
	return new Response(null, { status, headers: { location } });
}

describe("redirectable", () => {
	it("returns a non-redirect response from the first hop, stamping the request URL onto .url", async () => {
		const final = new Response("body", { status: 200 });
		const { baseFetch, calls } = makeBase([final]);

		const response = await redirectable(baseFetch, "fetchTest")("https://example.com/a");

		expect(response).toBe(final);
		expect(response.url).toBe("https://example.com/a");
		expect(calls).toEqual([{ url: "https://example.com/a", headers: undefined }]);
	});

	it("follows a 301 and stamps the terminal URL onto .url", async () => {
		const { baseFetch, calls } = makeBase([
			redirect(301, "https://example.com/final"),
			new Response("done", { status: 200 }),
		]);

		const response = await redirectable(baseFetch, "fetchTest")("https://example.com/start");

		expect(response.status).toBe(200);
		expect(response.url).toBe("https://example.com/final");
		expect(calls.map((c) => c.url)).toEqual(["https://example.com/start", "https://example.com/final"]);
	});

	it("stamps the last hop's URL after a multi-hop chain", async () => {
		const { baseFetch } = makeBase([
			redirect(301, "https://example.com/one"),
			redirect(302, "https://example.com/two"),
			new Response("done", { status: 200 }),
		]);

		const response = await redirectable(baseFetch, "fetchTest")("https://example.com/start");

		expect(response.url).toBe("https://example.com/two");
	});

	it("resolves a path-relative Location against the current hop's full path, not its origin", async () => {
		const { baseFetch, calls } = makeBase([
			redirect(302, "sub/page"),
			new Response("done", { status: 200 }),
		]);

		const response = await redirectable(baseFetch, "fetchTest")("https://example.com/current/path");

		expect(calls[1].url).toBe("https://example.com/current/sub/page");
		expect(response.url).toBe("https://example.com/current/sub/page");
	});

	it("returns a redirect-status response that has no Location header as the final response (WHATWG fetch semantics)", async () => {
		const missing = new Response(null, { status: 301 });
		const { baseFetch, calls } = makeBase([missing]);

		const response = await redirectable(baseFetch, "fetchTest")("https://example.com/a");

		expect(response).toBe(missing);
		expect(response.url).toBe("https://example.com/a");
		expect(calls).toHaveLength(1);
	});

	it("does not follow a non-redirect status even when a Location header is present", async () => {
		const { baseFetch, calls } = makeBase([
			new Response("ok", { status: 200, headers: { location: "https://example.com/elsewhere" } }),
		]);

		const response = await redirectable(baseFetch, "fetchTest")("https://example.com/a");

		expect(response.status).toBe(200);
		expect(response.url).toBe("https://example.com/a");
		expect(calls).toHaveLength(1);
	});

	it("fails after MAX_REDIRECTS consecutive redirects", async () => {
		const { baseFetch } = makeBase([redirect(302, "https://example.com/loop")]);

		await expect(
			redirectable(baseFetch, "fetchTest")("https://example.com/start"),
		).rejects.toThrow(/fetchTest failed for https:\/\/example\.com\/start: too many redirects \(>5\)/);
	});

	it("refuses an invalid entry URL under the label's error convention", async () => {
		const { baseFetch, calls } = makeBase([new Response("never", { status: 200 })]);

		await expect(redirectable(baseFetch, "fetchTest")("not a url")).rejects.toThrow(
			/fetchTest failed for not a url: invalid URL/,
		);
		expect(calls).toHaveLength(0);
	});

	it("refuses a non-HTTP(S) entry URL before any hop is requested", async () => {
		const { baseFetch, calls } = makeBase([new Response("never", { status: 200 })]);

		await expect(
			redirectable(baseFetch, "fetchTest")("file:///etc/passwd"),
		).rejects.toThrow(/fetchTest failed for file:\/\/\/etc\/passwd: refusing to fetch non-HTTP\(S\) scheme "file:"/);
		expect(calls).toHaveLength(0);
	});

	it("refuses a redirect to a non-HTTP(S) scheme with no further hop requested", async () => {
		const { baseFetch, calls } = makeBase([redirect(301, "gopher://example.com:70/1payload")]);

		await expect(
			redirectable(baseFetch, "fetchTest")("https://example.com/start"),
		).rejects.toThrow(/refusing to follow redirect to non-HTTP\(S\) scheme "gopher:"/);
		expect(calls).toHaveLength(1);
	});

	it("wraps a malformed Location header in the label's error convention", async () => {
		const { baseFetch } = makeBase([redirect(301, "https://exa mple.com/x")]);

		await expect(
			redirectable(baseFetch, "fetchTest")("https://example.com/start"),
		).rejects.toThrow(/fetchTest failed for https:\/\/example\.com\/start: invalid redirect Location "https:\/\/exa mple\.com\/x"/);
	});

	it("drops cookie/authorization/proxy-authorization on a cross-origin hop, case-insensitively", async () => {
		const { baseFetch, calls } = makeBase([
			redirect(301, "https://other.example/dest"),
			new Response("done", { status: 200 }),
		]);

		await redirectable(baseFetch, "fetchTest")("https://example.com/start", {
			headers: { Cookie: "s=secret", authorization: "Bearer t", "Proxy-Authorization": "Basic x", accept: "text/html" },
		});

		expect(calls[0].headers).toEqual({
			Cookie: "s=secret",
			authorization: "Bearer t",
			"Proxy-Authorization": "Basic x",
			accept: "text/html",
		});
		expect(calls[1].headers).toEqual({ accept: "text/html" });
	});

	it("keeps credential headers across a same-origin hop", async () => {
		const { baseFetch, calls } = makeBase([
			redirect(302, "/moved"),
			new Response("done", { status: 200 }),
		]);

		await redirectable(baseFetch, "fetchTest")("https://example.com/start", { headers: { cookie: "s=secret" } });

		expect(calls[1].headers).toEqual({ cookie: "s=secret" });
	});

	it("does not restore credential headers when a later hop returns to the original origin", async () => {
		const { baseFetch, calls } = makeBase([
			redirect(301, "https://other.example/bounce"),
			redirect(301, "https://example.com/back"),
			new Response("done", { status: 200 }),
		]);

		await redirectable(baseFetch, "fetchTest")("https://example.com/start", { headers: { cookie: "s=secret" } });

		expect(calls[2].url).toBe("https://example.com/back");
		expect(calls[2].headers).toEqual({});
	});

	it("threads the caller's signal into every hop", async () => {
		const controller = new AbortController();
		const seen: (AbortSignal | undefined)[] = [];
		const baseFetch: RedirectableFetch = async (url, init) => {
			seen.push(init?.signal);
			return url.endsWith("/start")
				? redirect(301, "https://example.com/final")
				: new Response("done", { status: 200 });
		};

		await redirectable(baseFetch, "fetchTest")("https://example.com/start", { signal: controller.signal });

		expect(seen).toEqual([controller.signal, controller.signal]);
	});
});
