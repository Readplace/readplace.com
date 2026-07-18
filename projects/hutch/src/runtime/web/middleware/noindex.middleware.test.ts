import type { NextFunction, Request, Response } from "express";
import { noindexMiddleware } from "./noindex.middleware";

interface FakeRes {
	headers: Record<string, string>;
	res: Response;
}

function createFakeRes(): FakeRes {
	const headers: Record<string, string> = {};
	const res = {
		set(name: string, value: string) {
			headers[name] = value;
			return res;
		},
	} as unknown as Response;
	return { headers, res };
}

describe("noindexMiddleware", () => {
	it("marks the response noindex via X-Robots-Tag so non-HTML shapes carry the signal", () => {
		const { headers, res } = createFakeRes();
		const next = jest.fn() as unknown as NextFunction;

		noindexMiddleware({} as Request, res, next);

		expect(headers["X-Robots-Tag"]).toBe("noindex");
		expect(next).toHaveBeenCalled();
	});

	it("overrides the site-wide Content-Signal with a full opt-out", () => {
		const { headers, res } = createFakeRes();
		const next = jest.fn() as unknown as NextFunction;

		noindexMiddleware({} as Request, res, next);

		expect(headers["Content-Signal"]).toBe("search=no, ai-input=no, ai-train=no");
	});
});
