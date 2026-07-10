import type { NextFunction, Request, Response } from "express";
import { CHANGELOG_DISMISS_COOKIE_NAME } from "@packages/web-shell";
import { changelogDismissMiddleware } from "./changelog-dismiss.middleware";
import "./session.types";

describe("changelogDismissMiddleware", () => {
	it("lifts the dismissal cookie value onto req.dismissedChangelogVersion", () => {
		const req = {
			cookies: { [CHANGELOG_DISMISS_COOKIE_NAME]: "a1b2c3d4" },
		} as unknown as Request;
		const next = jest.fn() as unknown as NextFunction;

		changelogDismissMiddleware(req, {} as Response, next);

		expect(req.dismissedChangelogVersion).toBe("a1b2c3d4");
		expect(next).toHaveBeenCalledTimes(1);
	});

	it("leaves req.dismissedChangelogVersion undefined when the cookie is absent", () => {
		const req = { cookies: {} } as unknown as Request;
		const next = jest.fn() as unknown as NextFunction;

		changelogDismissMiddleware(req, {} as Response, next);

		expect(req.dismissedChangelogVersion).toBeUndefined();
		expect(next).toHaveBeenCalledTimes(1);
	});
});
