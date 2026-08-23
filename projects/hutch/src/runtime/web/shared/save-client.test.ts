import assert from "node:assert/strict";
import type { Request } from "express";

import { IOS_CLIENT_HEADER, IOS_CLIENT_VALUE } from "../onboarding/ios-client";
import { saveClientOf } from "./save-client";

const READPLACE_IOS_APP = "Readplace/94 CFNetwork/3860.700.1 Darwin/25.6.0";
const READPLACE_SHARE_EXTENSION = "ShareExtension/94 CFNetwork/3860.700.1 Darwin/25.6.0";
const IPHONE_SAFARI =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

function reqWith(input: { headers?: Record<string, string>; query?: Request["query"] }): Request {
	const headers = input.headers ?? {};
	return {
		query: input.query ?? {},
		get(name: string): string | undefined {
			return headers[name.toLowerCase()];
		},
	} as Request;
}

describe("saveClientOf", () => {
	it("reports the iOS app for a native Siren request carrying the client header", () => {
		assert.equal(saveClientOf(reqWith({ headers: { [IOS_CLIENT_HEADER]: IOS_CLIENT_VALUE } })), "ios_app");
	});

	it("reports the iOS app for an in-app reader page, which cannot attach the header", () => {
		assert.equal(saveClientOf(reqWith({ query: { platform: "ios" } })), "ios_app");
	});

	it("reports the iOS app for a page hosted by the in-app web sheet", () => {
		assert.equal(saveClientOf(reqWith({ query: { shell: "app" } })), "ios_app");
	});

	it("reports the iOS app for our own app binary's User-Agent when no marker rides the request", () => {
		assert.equal(saveClientOf(reqWith({ headers: { "user-agent": READPLACE_IOS_APP } })), "ios_app");
	});

	it("reports the iOS app for the share extension's User-Agent, which carries no iPhone token", () => {
		assert.equal(saveClientOf(reqWith({ headers: { "user-agent": READPLACE_SHARE_EXTENSION } })), "ios_app");
	});

	it("reports the web client for a plain browser request", () => {
		assert.equal(saveClientOf(reqWith({ headers: { "user-agent": IPHONE_SAFARI } })), "web");
	});

	it("reports the web client for a request with no User-Agent at all", () => {
		assert.equal(saveClientOf(reqWith({})), "web");
	});

	it("reports the web client for a client header naming some other platform", () => {
		assert.equal(saveClientOf(reqWith({ headers: { [IOS_CLIENT_HEADER]: "android" } })), "web");
	});

	it("reports the web client for a User-Agent that merely mentions our app rather than being it", () => {
		assert.equal(saveClientOf(reqWith({ headers: { "user-agent": `Googlebot ${READPLACE_IOS_APP}` } })), "web");
	});
});
