import assert from "node:assert/strict";
import type { Request } from "express";
import { NATIVE_CLIENT_HEADER } from "../../onboarding/native-client";
import { APP_BACK_LINK } from "../../shared/native-app-links";
import { appSurfaceLinkParams, appSurfaceOf } from "./queue.app-surface";

function request(input: {
	query?: Record<string, unknown>;
	clientHeader?: string;
}): Request {
	return {
		query: input.query ?? {},
		get(name: string) {
			return name.toLowerCase() === NATIVE_CLIENT_HEADER ? input.clientHeader : undefined;
		},
	} as unknown as Request;
}

describe("appSurfaceLinkParams", () => {
	it("stamps nothing on a plain browser request, so every web href renders byte-identically", () => {
		expect(appSurfaceLinkParams(request({}))).toEqual([]);
	});

	it("stamps platform before shell so a marked href reads the same on every control", () => {
		const params = appSurfaceLinkParams(request({ query: { platform: "ios", shell: "app" } }));

		expect(params).toEqual([
			["platform", "ios"],
			["shell", "app"],
		]);
	});

	it("never invents a platform for a shell-only build, whose POSTs would land on another app's surface", () => {
		expect(appSurfaceLinkParams(request({ query: { shell: "app" } }))).toEqual([["shell", "app"]]);
	});

	it("never invents the shell marker, which a build predating it cannot intercept", () => {
		expect(appSurfaceLinkParams(request({ query: { platform: "ios" } }))).toEqual([
			["platform", "ios"],
		]);
	});

	it("reads the platform off the client header, so a header-only build still gets marked hrefs", () => {
		expect(appSurfaceLinkParams(request({ clientHeader: "android" }))).toEqual([
			["platform", "android"],
		]);
	});

	it("stamps nothing for a platform no shipped app sends", () => {
		expect(appSurfaceLinkParams(request({ query: { platform: "nonsense" } }))).toEqual([]);
	});
});

describe("appSurfaceOf", () => {
	it("resolves no surface for a plain browser request", () => {
		expect(appSurfaceOf(request({}))).toBeUndefined();
	});

	it.each([
		["the shell marker alone", request({ query: { shell: "app" } })],
		["the platform marker alone", request({ query: { platform: "ios" } })],
		["the client header alone", request({ clientHeader: "ios" })],
	])("points the back link at the sheet-close deep link for %s", (_name, req) => {
		const surface = appSurfaceOf(req);
		assert(surface, "a native-surface request must resolve a surface");

		expect(surface.backLink.href).toBe(APP_BACK_LINK.topHref);
		expect(surface.backLink.label).toBe("Back to Reading List");
	});
});
