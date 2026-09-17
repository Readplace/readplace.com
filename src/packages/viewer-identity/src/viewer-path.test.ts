import type { Request, Response } from "express";
import { createViewerIdentityMiddleware } from "./viewer-identity.middleware";
import { EDGE_SECRET_HEADER, VIEWER_PATH_HEADER } from "./viewer-identity";

function receive(
	path: string | string[] | undefined,
	url = "/view",
	secret: string | undefined = "edge",
) {
	const req = {
		url,
		originalUrl: url,
		headers: { [VIEWER_PATH_HEADER]: path, [EDGE_SECRET_HEADER]: secret },
	} as unknown as Request;
	const send = jest.fn();
	const status = jest.fn().mockReturnValue({ send });
	const next = jest.fn();
	createViewerIdentityMiddleware({ edgeSecret: "edge" })(
		req,
		{ status } as unknown as Response,
		next,
	);
	return { req, send, status, next };
}

describe("trusted reader path restoration", () => {
	it.each([
		"/view/",
		"/VIEW/https://example.com/a//b;one,two+three/%E2%98%83/%2F/%zz",
		`/view/example.com/${"a".repeat(8000)}`,
	])("preserves the path and raw outer query: %.60s", (path) => {
		const query =
			"?format=epub&x=&x=two+words&url=https%3A%2F%2Fexample.com&flag";
		const result = receive(path, `/view${query}`);
		expect(result.req.url).toBe(path + query);
		expect(result.req.originalUrl).toBe(path + query);
		expect(result.next).toHaveBeenCalledTimes(1);
		expect(result.status).not.toHaveBeenCalled();
	});

	it("restores a path without an outer query", () => {
		expect(receive("/view/https://example.com").req.url).toBe(
			"/view/https://example.com",
		);
	});

	it.each([
		"",
		"/other/a",
		"/view",
		"/view/a?injected=1",
		"/view/a#fragment",
		"/view/a b",
		"/view/a\r\nb",
		"/view/é",
		"/view/a\x7f",
		["/view/a", "/view/b"],
	])("rejects authenticated malformed data without exposing it: %j", (path) => {
		const result = receive(path);
		expect(result.status).toHaveBeenCalledWith(400);
		expect(result.send).toHaveBeenCalledWith("Bad Request");
		expect(result.next).not.toHaveBeenCalled();
		expect(result.req.url).toBe("/view");
	});

	it.each([
		"/other",
		"/view/",
		"/view/article",
		"/viewer",
		"/VIEW",
	])("rejects preservation outside the internal endpoint: %s", (url) => {
		expect(receive("/view/article", url).status).toHaveBeenCalledWith(400);
	});

	it.each([
		"wrong",
		"",
		undefined,
	])("ignores untrusted preservation: %s", (secret) => {
		// Explicitly remove the proof to avoid the helper's default argument.
		const result = receive(
			"/view/spoof",
			"/view?x=1",
			secret === undefined ? "" : secret,
		);
		expect(result.req.url).toBe("/view?x=1");
		expect(result.next).toHaveBeenCalledTimes(1);
	});

	it.each([
		"/view",
		"/view/",
		"/view?url=example.com",
		"/other",
	])("retains direct-origin behavior without preservation: %s", (url) => {
		const result = receive(undefined, url);
		expect(result.req.url).toBe(url);
		expect(result.req.originalUrl).toBe(url);
		expect(result.next).toHaveBeenCalledTimes(1);
	});
});
