import type { Request } from "express";
import { ALIVE_COOKIE_NAME, ALIVE_COOKIE_VALUE } from "@packages/onboarding-extension-signal";
import { requestCanCapture } from "./capture-capable-request";
import { APP_SHELL_QUERY, APP_SHELL_VALUE, NATIVE_CLIENT_HEADER, PLATFORM_QUERY } from "./native-client";

function requestWith(input: {
	cookies?: Record<string, string>;
	query?: Record<string, string>;
	headers?: Record<string, string>;
	oauthClientId?: string;
}): Request {
	const headers = input.headers ?? {};
	const req: Partial<Request> = {
		cookies: input.cookies ?? {},
		query: input.query ?? {},
		oauthClientId: input.oauthClientId,
		get: ((name: string) => headers[name]) as Request["get"],
	};
	return req as Request;
}

describe("requestCanCapture", () => {
	it("is true when the browser extension's alive cookie is present", () => {
		expect(requestCanCapture(requestWith({ cookies: { [ALIVE_COOKIE_NAME]: ALIVE_COOKIE_VALUE } }))).toBe(true);
	});

	it("is true inside an app's web sheet", () => {
		expect(requestCanCapture(requestWith({ query: { [APP_SHELL_QUERY]: APP_SHELL_VALUE } }))).toBe(true);
	});

	it.each(["ios", "android"])("is true inside the %s app's reader sheet opened with ?platform=", (platform) => {
		expect(requestCanCapture(requestWith({ query: { [PLATFORM_QUERY]: platform } }))).toBe(true);
	});

	it("is true for a request carrying the native client header", () => {
		expect(requestCanCapture(requestWith({ headers: { [NATIVE_CLIENT_HEADER]: "ios" } }))).toBe(true);
	});

	it.each(["hutch-firefox-extension", "hutch-chrome-extension", "ios-app", "android-app"])(
		"is true for the content-capture OAuth client %s",
		(oauthClientId) => {
			expect(requestCanCapture(requestWith({ oauthClientId }))).toBe(true);
		},
	);

	it("is false for an OAuth client that only sends urls", () => {
		expect(requestCanCapture(requestWith({ oauthClientId: "some-mcp-client" }))).toBe(false);
	});

	it("is false for a plain browser session with no capture client", () => {
		expect(requestCanCapture(requestWith({}))).toBe(false);
	});
});
