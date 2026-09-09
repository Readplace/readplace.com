import type { Request } from "express";
import { NATIVE_CLIENT_HEADER, nativeSurfaceQuery } from "./native-client";

function requestWith(input: {
	query?: Record<string, string>;
	client?: string;
}): Request {
	const req: Partial<Request> = {
		query: input.query ?? {},
		get: ((name: string) =>
			name === NATIVE_CLIENT_HEADER ? input.client : undefined) as Request["get"],
	};
	return req as Request;
}

describe("nativeSurfaceQuery", () => {
	it("carries nothing for a plain browser request", () => {
		expect(nativeSurfaceQuery(requestWith({}))).toBe("");
	});

	it("carries the platform a page load marks itself with", () => {
		expect(nativeSurfaceQuery(requestWith({ query: { platform: "android" } }))).toBe(
			"platform=android",
		);
	});

	it("carries the shell marker a build that names no platform still sends", () => {
		expect(nativeSurfaceQuery(requestWith({ query: { shell: "app" } }))).toBe("shell=app");
	});

	it("puts the platform before the shell when a request carries both", () => {
		expect(
			nativeSurfaceQuery(requestWith({ query: { platform: "ios", shell: "app" } })),
		).toBe("platform=ios&shell=app");
	});

	it("reads the platform off the native client header when no query names one", () => {
		expect(nativeSurfaceQuery(requestWith({ client: "ios" }))).toBe("platform=ios");
	});
});
