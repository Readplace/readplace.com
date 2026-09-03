import assert from "node:assert/strict";
import type { Request } from "express";
import { ALIVE_COOKIE_NAME, ALIVE_COOKIE_VALUE } from "@packages/onboarding-extension-signal";
import {
	advertisedPlatformOf,
	canOfferExtensionInstall,
	detectPlatform,
	extensionInstallUrlIfMissing,
	hasInstallableClient,
} from "./extension-install";

/** Minimal request carrying only the header the functions under test read. A
 * bare `{}` (no key) models a request that sent no User-Agent at all — the
 * branch supertest can't reproduce because it always sends one. */
function requestWithUserAgent(userAgent?: string): Request {
	const headers: Record<string, string | undefined> =
		userAgent === undefined ? {} : { "user-agent": userAgent };
	return { headers } as Request;
}

const ANDROID_CHROME =
	"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";
const DESKTOP_SAFARI =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const DESKTOP_CHROME =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const ANDROID_FIREFOX = "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0";
const MACOS_FIREFOX =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0";
const IPHONE_SAFARI =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.0.0 Mobile/15E148 Safari/604.1";

describe("hasInstallableClient", () => {
	it("returns false for Android while its app is not advertised — there is nothing to send the visitor to install", () => {
		assert.equal(hasInstallableClient(requestWithUserAgent(ANDROID_CHROME)), false);
	});

	it("returns false for desktop Safari (the unrecognised 'other' bucket)", () => {
		assert.equal(hasInstallableClient(requestWithUserAgent(DESKTOP_SAFARI)), false);
	});

	it("returns true for desktop Chrome", () => {
		assert.equal(hasInstallableClient(requestWithUserAgent(DESKTOP_CHROME)), true);
	});

	it("returns false when the request carries no User-Agent header", () => {
		assert.equal(hasInstallableClient(requestWithUserAgent()), false);
	});
});

describe("canOfferExtensionInstall", () => {
	it("offers the pitch on a platform with an advertised client to install", () => {
		assert.equal(canOfferExtensionInstall(requestWithUserAgent(DESKTOP_CHROME)), true);
	});

	it("offers the pitch to a visitor who already holds the extension, whatever their platform", () => {
		const req = requestWithUserAgent(DESKTOP_SAFARI);
		req.cookies = { [ALIVE_COOKIE_NAME]: ALIVE_COOKIE_VALUE };
		assert.equal(canOfferExtensionInstall(req), true);
	});

	it("withholds the pitch when there is neither an extension nor an advertised client", () => {
		assert.equal(canOfferExtensionInstall(requestWithUserAgent(ANDROID_CHROME)), false);
	});
});

describe("advertisedPlatformOf", () => {
	it("answers the platform for a visitor whose client is advertised", () => {
		assert.equal(advertisedPlatformOf(requestWithUserAgent(DESKTOP_CHROME)), "chrome");
	});

	it("answers undefined for Android, whose app is not advertised", () => {
		assert.equal(advertisedPlatformOf(requestWithUserAgent(ANDROID_CHROME)), undefined);
	});

	it("answers undefined for the unrecognised other bucket", () => {
		assert.equal(advertisedPlatformOf(requestWithUserAgent(DESKTOP_SAFARI)), undefined);
	});
});

describe("detectPlatform", () => {
	it("resolves a macOS Firefox User-Agent to firefox", () => {
		assert.equal(detectPlatform(requestWithUserAgent(MACOS_FIREFOX)), "firefox");
	});

	it("resolves iOS Safari to iphone", () => {
		assert.equal(detectPlatform(requestWithUserAgent(IPHONE_SAFARI)), "iphone");
	});

	it("resolves iOS Chrome to iphone rather than chrome, since CriOS carries no Chrome/ token", () => {
		assert.equal(detectPlatform(requestWithUserAgent(IPHONE_CHROME)), "iphone");
	});

	it("resolves Android Firefox to android rather than firefox, since the Android token outranks the browser one", () => {
		assert.equal(detectPlatform(requestWithUserAgent(ANDROID_FIREFOX)), "android");
	});

	it("resolves Android Chrome to android for the same reason", () => {
		assert.equal(detectPlatform(requestWithUserAgent(ANDROID_CHROME)), "android");
	});

	it("resolves desktop Safari to the other bucket", () => {
		assert.equal(detectPlatform(requestWithUserAgent(DESKTOP_SAFARI)), "other");
	});
});

describe("extensionInstallUrlIfMissing", () => {
	it("surfaces nothing on Android Chrome, a native-app platform where the extension wording does not apply", () => {
		assert.equal(extensionInstallUrlIfMissing(requestWithUserAgent(ANDROID_CHROME)), undefined);
	});

	it("surfaces nothing on Android Firefox, for the same reason", () => {
		assert.equal(extensionInstallUrlIfMissing(requestWithUserAgent(ANDROID_FIREFOX)), undefined);
	});

	it("keeps the browser-specific URL on desktop Chrome", () => {
		assert.equal(
			extensionInstallUrlIfMissing(requestWithUserAgent(DESKTOP_CHROME)),
			"/install?client=chrome",
		);
	});

	it("surfaces nothing on iPhone, where the extension wording does not apply", () => {
		assert.equal(extensionInstallUrlIfMissing(requestWithUserAgent(IPHONE_SAFARI)), undefined);
	});
});
