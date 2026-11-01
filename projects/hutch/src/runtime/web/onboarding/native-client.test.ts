import type { Request } from "express";
import { NATIVE_CLIENT_HEADER, isIosBuildBeforeRekeyedShareTargets, nativeSurfaceQuery, readlistQueryKeyOf } from "./native-client";

function requestWith(input: {
	query?: Record<string, string>;
	client?: string;
	userAgent?: string;
}): Request {
	const req: Partial<Request> = {
		query: input.query ?? {},
		get: ((name: string) =>
			({ [NATIVE_CLIENT_HEADER]: input.client, "user-agent": input.userAgent })[name]) as Request["get"],
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

describe("isIosBuildBeforeRekeyedShareTargets", () => {
	it.each([
		{ userAgent: "Readplace/133 CFNetwork/3860.700.1 Darwin/25.6.0", expected: true },
		{ userAgent: "ShareExtension/107 CFNetwork/3860.700.1 Darwin/25.6.0", expected: true },
		{ userAgent: "Readplace/build-133 iOS/26.1", expected: true },
		{ userAgent: "ShareExtension/build-134 iOS/26.1", expected: false },
		{ userAgent: "Readplace/134 CFNetwork/3860.700.1 Darwin/25.6.0", expected: false },
		{ userAgent: "Readplace/90 Android/16", expected: false },
		{ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Readplace/100 CFNetwork/1 Darwin/1", expected: false },
		{ userAgent: undefined, expected: false },
	])("reads $userAgent as an iPhone build before 134: $expected", ({ userAgent, expected }) => {
		expect(isIosBuildBeforeRekeyedShareTargets(requestWith({ userAgent }))).toBe(expected);
	});
});

describe("readlistQueryKeyOf", () => {
	it("keeps the retired queue key for an old iPhone build and gives every other client the readlist key", () => {
		expect([
			readlistQueryKeyOf(requestWith({ userAgent: "Readplace/133 CFNetwork/3860.700.1 Darwin/25.6.0" })),
			readlistQueryKeyOf(requestWith({ userAgent: "Readplace/build-134 iOS/26.1" })),
			readlistQueryKeyOf(requestWith({ userAgent: "Readplace/90 Android/16" })),
		]).toEqual(["queue", "readlist", "readlist"]);
	});
});
