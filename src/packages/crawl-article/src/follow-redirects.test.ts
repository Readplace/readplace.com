import { followRedirects, type RequestHop } from "./follow-redirects";

type Hop = { url: string; headers: Record<string, string> | undefined };

function makeHops(responses: Response[]): { requestHop: RequestHop; hops: Hop[] } {
	const hops: Hop[] = [];
	let index = 0;
	const requestHop: RequestHop = async (hop) => {
		hops.push(hop);
		const response = responses[Math.min(index, responses.length - 1)];
		index++;
		return response;
	};
	return { requestHop, hops };
}

function redirect(status: number, location: string): Response {
	return new Response(null, { status, headers: { location } });
}

describe("followRedirects", () => {
	it("returns a non-redirect response from the first hop untouched", async () => {
		const final = new Response("body", { status: 200 });
		const { requestHop, hops } = makeHops([final]);

		const response = await followRedirects({ label: "fetchTest", url: "https://example.com/a", requestHop });

		expect(response).toBe(final);
		expect(hops).toEqual([{ url: "https://example.com/a", headers: undefined }]);
	});

	it("follows a 301 to the final destination", async () => {
		const { requestHop, hops } = makeHops([
			redirect(301, "https://example.com/final"),
			new Response("done", { status: 200 }),
		]);

		const response = await followRedirects({ label: "fetchTest", url: "https://example.com/start", requestHop });

		expect(response.status).toBe(200);
		expect(hops.map((h) => h.url)).toEqual(["https://example.com/start", "https://example.com/final"]);
	});

	it("resolves a path-relative Location against the current hop's full path, not its origin", async () => {
		const { requestHop, hops } = makeHops([
			redirect(302, "sub/page"),
			new Response("done", { status: 200 }),
		]);

		await followRedirects({ label: "fetchTest", url: "https://example.com/current/path", requestHop });

		expect(hops[1].url).toBe("https://example.com/current/sub/page");
	});

	it("returns a redirect-status response that has no Location header as the final response (WHATWG fetch semantics)", async () => {
		const missing = new Response(null, { status: 301 });
		const { requestHop, hops } = makeHops([missing]);

		const response = await followRedirects({ label: "fetchTest", url: "https://example.com/a", requestHop });

		expect(response).toBe(missing);
		expect(hops).toHaveLength(1);
	});

	it("does not follow a non-redirect status even when a Location header is present", async () => {
		const { requestHop, hops } = makeHops([
			new Response("ok", { status: 200, headers: { location: "https://example.com/elsewhere" } }),
		]);

		const response = await followRedirects({ label: "fetchTest", url: "https://example.com/a", requestHop });

		expect(response.status).toBe(200);
		expect(hops).toHaveLength(1);
	});

	it("fails after MAX_REDIRECTS consecutive redirects", async () => {
		const { requestHop } = makeHops([redirect(302, "https://example.com/loop")]);

		await expect(
			followRedirects({ label: "fetchTest", url: "https://example.com/start", requestHop }),
		).rejects.toThrow(/fetchTest failed for https:\/\/example\.com\/start: too many redirects \(>5\)/);
	});

	it("refuses an invalid entry URL under the label's error convention", async () => {
		const { requestHop, hops } = makeHops([new Response("never", { status: 200 })]);

		await expect(followRedirects({ label: "fetchTest", url: "not a url", requestHop })).rejects.toThrow(
			/fetchTest failed for not a url: invalid URL/,
		);
		expect(hops).toHaveLength(0);
	});

	it("refuses a non-HTTP(S) entry URL before any hop is requested", async () => {
		const { requestHop, hops } = makeHops([new Response("never", { status: 200 })]);

		await expect(
			followRedirects({ label: "fetchTest", url: "file:///etc/passwd", requestHop }),
		).rejects.toThrow(/fetchTest failed for file:\/\/\/etc\/passwd: refusing to fetch non-HTTP\(S\) scheme "file:"/);
		expect(hops).toHaveLength(0);
	});

	it("refuses a redirect to a non-HTTP(S) scheme with no further hop requested", async () => {
		const { requestHop, hops } = makeHops([redirect(301, "gopher://example.com:70/1payload")]);

		await expect(
			followRedirects({ label: "fetchTest", url: "https://example.com/start", requestHop }),
		).rejects.toThrow(/refusing to follow redirect to non-HTTP\(S\) scheme "gopher:"/);
		expect(hops).toHaveLength(1);
	});

	it("wraps a malformed Location header in the label's error convention", async () => {
		const { requestHop } = makeHops([redirect(301, "https://exa mple.com/x")]);

		await expect(
			followRedirects({ label: "fetchTest", url: "https://example.com/start", requestHop }),
		).rejects.toThrow(/fetchTest failed for https:\/\/example\.com\/start: invalid redirect Location "https:\/\/exa mple\.com\/x"/);
	});

	it("drops cookie/authorization/proxy-authorization on a cross-origin hop, case-insensitively", async () => {
		const { requestHop, hops } = makeHops([
			redirect(301, "https://other.example/dest"),
			new Response("done", { status: 200 }),
		]);

		await followRedirects({
			label: "fetchTest",
			url: "https://example.com/start",
			headers: { Cookie: "s=secret", authorization: "Bearer t", "Proxy-Authorization": "Basic x", accept: "text/html" },
			requestHop,
		});

		expect(hops[0].headers).toEqual({
			Cookie: "s=secret",
			authorization: "Bearer t",
			"Proxy-Authorization": "Basic x",
			accept: "text/html",
		});
		expect(hops[1].headers).toEqual({ accept: "text/html" });
	});

	it("keeps credential headers across a same-origin hop", async () => {
		const { requestHop, hops } = makeHops([
			redirect(302, "/moved"),
			new Response("done", { status: 200 }),
		]);

		await followRedirects({
			label: "fetchTest",
			url: "https://example.com/start",
			headers: { cookie: "s=secret" },
			requestHop,
		});

		expect(hops[1].headers).toEqual({ cookie: "s=secret" });
	});

	it("does not restore credential headers when a later hop returns to the original origin", async () => {
		const { requestHop, hops } = makeHops([
			redirect(301, "https://other.example/bounce"),
			redirect(301, "https://example.com/back"),
			new Response("done", { status: 200 }),
		]);

		await followRedirects({
			label: "fetchTest",
			url: "https://example.com/start",
			headers: { cookie: "s=secret" },
			requestHop,
		});

		expect(hops[2].url).toBe("https://example.com/back");
		expect(hops[2].headers).toEqual({});
	});
});
