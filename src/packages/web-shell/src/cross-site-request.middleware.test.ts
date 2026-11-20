import type { NextFunction, Request, Response } from "express";
import { SESSION_COOKIE_NAME } from "@packages/web-session";
import { createCrossSiteRequestMiddleware } from "./cross-site-request.middleware";

const APP_ORIGIN = "https://readplace.com";
const SESSION_COOKIES = { [SESSION_COOKIE_NAME]: "any-session" };

function fakeRequest(input: {
	method: string;
	cookies: Record<string, string> | undefined;
	headers: Record<string, string>;
}): Request {
	const lowerCased = new Map(Object.entries(input.headers).map(([name, value]) => [name.toLowerCase(), value]));
	const req = {
		method: input.method,
		cookies: input.cookies,
		get: (name: string) => lowerCased.get(name.toLowerCase()),
	};
	return req as unknown as Request;
}

function run(input: { method: string; cookies: Record<string, string> | undefined; headers: Record<string, string> }) {
	const statuses: number[] = [];
	const res: Partial<Response> = {
		sendStatus(status: number) {
			statuses.push(status);
			return this as Response;
		},
	};
	let nextCalls = 0;
	const next: NextFunction = () => {
		nextCalls += 1;
	};
	createCrossSiteRequestMiddleware({ appOrigin: APP_ORIGIN })(fakeRequest(input), res as Response, next);
	return { statuses, nextCalls };
}

describe("createCrossSiteRequestMiddleware", () => {
	it.each(["GET", "HEAD", "OPTIONS"])("lets a cross-site %s through", (method) => {
		const result = run({ method, cookies: SESSION_COOKIES, headers: { "Sec-Fetch-Site": "cross-site" } });
		expect(result).toEqual({ statuses: [], nextCalls: 1 });
	});

	it("lets a cross-site POST through when it carries no session cookie", () => {
		const result = run({ method: "POST", cookies: {}, headers: { "Sec-Fetch-Site": "cross-site" } });
		expect(result).toEqual({ statuses: [], nextCalls: 1 });
	});

	it("lets a cross-site POST through when no cookies were parsed", () => {
		const result = run({ method: "POST", cookies: undefined, headers: { "Sec-Fetch-Site": "cross-site" } });
		expect(result).toEqual({ statuses: [], nextCalls: 1 });
	});

	it("lets a cross-site POST through when it authenticates with an Authorization header", () => {
		const result = run({
			method: "POST",
			cookies: SESSION_COOKIES,
			headers: { "Sec-Fetch-Site": "cross-site", Authorization: "Bearer token" },
		});
		expect(result).toEqual({ statuses: [], nextCalls: 1 });
	});

	it.each([
		["Sec-Fetch-Site cross-site", { "Sec-Fetch-Site": "cross-site" }],
		["Sec-Fetch-Site same-site", { "Sec-Fetch-Site": "same-site" }],
		["a foreign Origin without Sec-Fetch-Site", { Origin: "https://example.org" }],
	])("refuses a POST riding on the session cookie with %s", (_case, headers) => {
		const result = run({ method: "POST", cookies: SESSION_COOKIES, headers });
		expect(result).toEqual({ statuses: [403], nextCalls: 0 });
	});

	it.each([
		["Sec-Fetch-Site same-origin", { "Sec-Fetch-Site": "same-origin" }],
		["Sec-Fetch-Site none", { "Sec-Fetch-Site": "none" }],
		["Sec-Fetch-Site same-origin despite a foreign Origin", { "Sec-Fetch-Site": "same-origin", Origin: "https://example.org" }],
		["the app's own Origin", { Origin: APP_ORIGIN }],
		["no Origin and no Sec-Fetch-Site", {}],
	])("lets a POST riding on the session cookie with %s through", (_case, headers) => {
		const result = run({ method: "POST", cookies: SESSION_COOKIES, headers });
		expect(result).toEqual({ statuses: [], nextCalls: 1 });
	});
});
