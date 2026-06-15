import type { NextFunction, Request, Response } from "express";
import {
	CONTENT_SIGNAL_VALUE,
	contentSignalMiddleware,
} from "./content-signal.middleware";

function run(method: string, path: string) {
	const headers: Record<string, string> = {};
	let varied: string | undefined;
	let nextCalled = false;
	const req = { method, path } as unknown as Request;
	const res = {
		set: (name: string, value: string) => {
			headers[name] = value;
		},
		vary: (header: string) => {
			varied = header;
		},
	} as unknown as Response;
	const next: NextFunction = () => {
		nextCalled = true;
	};
	contentSignalMiddleware(req, res, next);
	return { headers, varied, nextCalled };
}

describe("contentSignalMiddleware", () => {
	it("sets Content-Signal and Vary: Accept on a GET page request", () => {
		const { headers, varied } = run("GET", "/blog");
		expect(headers["Content-Signal"]).toBe(CONTENT_SIGNAL_VALUE);
		expect(varied).toBe("Accept");
	});

	it("skips the sitemap (machine metadata, not a page)", () => {
		const { headers, varied } = run("GET", "/blog/sitemap.xml");
		expect(headers["Content-Signal"]).toBeUndefined();
		expect(varied).toBeUndefined();
	});

	it("skips non-GET requests", () => {
		const { headers } = run("POST", "/blog");
		expect(headers["Content-Signal"]).toBeUndefined();
	});

	it("always calls next", () => {
		expect(run("GET", "/blog").nextCalled).toBe(true);
		expect(run("GET", "/blog/sitemap.xml").nextCalled).toBe(true);
	});
});
