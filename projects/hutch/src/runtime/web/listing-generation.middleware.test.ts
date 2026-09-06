import type { NextFunction, Request, Response } from "express";
import {
	LISTING_GENERATION_COOKIE_NAME,
	createListingGenerationMiddleware,
} from "./listing-generation.middleware";

interface CookieCall {
	name: string;
	value: string;
	options: unknown;
}

function createFakeRes(): { cookies: CookieCall[]; res: Response } {
	const cookies: CookieCall[] = [];
	const res = {
		cookie(name: string, value: string, options: unknown) {
			cookies.push({ name, value, options });
			return res;
		},
	} as unknown as Response;
	return { cookies, res };
}

function stampingGeneration() {
	let counter = 0;
	return createListingGenerationMiddleware({
		nextGeneration: () => `gen-${++counter}`,
		secure: true,
	});
}

describe("createListingGenerationMiddleware", () => {
	it("stamps a fresh generation cookie on a mutating request so the next listing read misses", () => {
		const { cookies, res } = createFakeRes();
		const next = jest.fn() as unknown as NextFunction;

		stampingGeneration()({ method: "POST" } as Request, res, next);

		expect(cookies).toEqual([
			{
				name: LISTING_GENERATION_COOKIE_NAME,
				value: "gen-1",
				options: { httpOnly: true, sameSite: "lax", path: "/", secure: true },
			},
		]);
		expect(next).toHaveBeenCalled();
	});

	it.each(["GET", "HEAD"])(
		"leaves a %s response's cookies untouched so a repeat read still hits the cache",
		(method) => {
			const { cookies, res } = createFakeRes();
			const next = jest.fn() as unknown as NextFunction;

			stampingGeneration()({ method } as Request, res, next);

			expect(cookies).toEqual([]);
			expect(next).toHaveBeenCalled();
		},
	);
});
