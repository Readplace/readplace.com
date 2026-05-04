import type { NextFunction, Request, Response } from "express";
import {
	CONTENT_SIGNAL_VALUE,
	contentSignalMiddleware,
} from "./content-signal.middleware";

interface FakeRes {
	headers: Record<string, string>;
	varied: string[];
	res: Response;
}

function createFakeRes(): FakeRes {
	const headers: Record<string, string> = {};
	const varied: string[] = [];
	const res = {
		set(name: string, value: string) {
			headers[name] = value;
			return res;
		},
		vary(field: string) {
			varied.push(field);
			return res;
		},
	} as unknown as Response;
	return { headers, varied, res };
}

describe("contentSignalMiddleware", () => {
	it("sets the site-wide Content-Signal policy on GET responses", () => {
		const { headers, res } = createFakeRes();
		const next = jest.fn() as unknown as NextFunction;

		contentSignalMiddleware({ method: "GET" } as Request, res, next);

		expect(headers["Content-Signal"]).toBe(CONTENT_SIGNAL_VALUE);
		expect(next).toHaveBeenCalled();
	});

	it("varies on Accept so a CDN keys HTML and markdown separately", () => {
		const { varied, res } = createFakeRes();
		const next = jest.fn() as unknown as NextFunction;

		contentSignalMiddleware({ method: "GET" } as Request, res, next);

		expect(varied).toEqual(["Accept"]);
	});

	it("does not set the Content-Signal header on non-GET requests", () => {
		const { headers, varied, res } = createFakeRes();
		const next = jest.fn() as unknown as NextFunction;

		contentSignalMiddleware({ method: "POST" } as Request, res, next);

		expect(headers["Content-Signal"]).toBeUndefined();
		expect(varied).toEqual([]);
		expect(next).toHaveBeenCalled();
	});
});
