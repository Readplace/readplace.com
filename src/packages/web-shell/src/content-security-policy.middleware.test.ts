import type { NextFunction, Request, Response } from "express";
import { sendContentSecurityPolicy } from "./content-security-policy.middleware";

const NO_REQ = {} as unknown as Request;

describe("sendContentSecurityPolicy", () => {
	it("limits framing to the same origin, forbids plugin elements and same-origin base URLs only, leaving script and style sources open, then continues the chain", () => {
		const headers = new Map<string, string>();
		const res: Partial<Response> = {
			setHeader(name: string, value: string | number | readonly string[]) {
				headers.set(name, String(value));
				return this as Response;
			},
		};
		let nextCalls = 0;
		const next: NextFunction = () => {
			nextCalls += 1;
		};

		sendContentSecurityPolicy(NO_REQ, res as Response, next);

		expect(headers.get("Content-Security-Policy")).toBe(
			"frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
		);
		expect(nextCalls).toBe(1);
	});
});
