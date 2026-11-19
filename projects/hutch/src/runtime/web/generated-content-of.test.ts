import type { ViewerIdentity } from "@packages/viewer-identity";
import type { Request } from "express";
import { STOREFRONT_COOKIE_NAME, STOREFRONT_HEADER, generatedContentOf } from "./generated-content-of";

function requestWith(input: {
	country?: string;
	header?: string;
	cookie?: string;
}): Request {
	const viewer: ViewerIdentity = {
		ip: undefined,
		host: "readplace.com",
		location: input.country === undefined ? undefined : { country: input.country },
	};
	const req: Partial<Request> = {
		viewer,
		cookies: input.cookie === undefined ? {} : { [STOREFRONT_COOKIE_NAME]: input.cookie },
		get: ((name: string) => ({ [STOREFRONT_HEADER]: input.header })[name]) as Request["get"],
	};
	return req as Request;
}

describe("generatedContentOf", () => {
	it("pins the storefront header and cookie names baked into released app binaries", () => {
		expect({ STOREFRONT_HEADER, STOREFRONT_COOKIE_NAME }).toEqual({
			STOREFRONT_HEADER: "x-readplace-storefront",
			STOREFRONT_COOKIE_NAME: "readplace_storefront",
		});
	});

	it.each([
		{ name: "no signal", input: {}, access: "shown" },
		{ name: "a viewer outside China", input: { country: "AU" }, access: "shown" },
		{ name: "a viewer in China", input: { country: "CN" }, access: "withheld" },
		{ name: "the China storefront header", input: { header: "CHN" }, access: "withheld" },
		{ name: "another storefront header", input: { header: "AUS" }, access: "shown" },
		{ name: "the China storefront cookie", input: { cookie: "CHN" }, access: "withheld" },
		{ name: "an unparseable header falling back to the cookie", input: { header: "china", cookie: "CHN" }, access: "withheld" },
		{ name: "the header over the cookie", input: { header: "AUS", cookie: "CHN" }, access: "shown" },
	])("answers $access for $name", ({ input, access }) => {
		expect(generatedContentOf(requestWith(input))).toBe(access);
	});
});
