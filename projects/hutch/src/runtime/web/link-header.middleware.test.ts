import type { NextFunction, Request, Response } from "express";
import { API_CATALOG_LINK, linkHeaderMiddleware } from "./link-header.middleware";

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

describe("linkHeaderMiddleware", () => {
	it("advertises the api-catalog via a Link header on GET responses", () => {
		const { headers, res } = createFakeRes();
		const next = jest.fn() as unknown as NextFunction;

		linkHeaderMiddleware({ method: "GET" } as Request, res, next);

		expect(headers.Link).toBe(API_CATALOG_LINK);
		expect(next).toHaveBeenCalled();
	});

	it("does not set a Link header on non-GET requests", () => {
		const { headers, res } = createFakeRes();
		const next = jest.fn() as unknown as NextFunction;

		linkHeaderMiddleware({ method: "POST" } as Request, res, next);

		expect(headers.Link).toBeUndefined();
		expect(next).toHaveBeenCalled();
	});
});
