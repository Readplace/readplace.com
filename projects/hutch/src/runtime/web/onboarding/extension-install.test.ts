import assert from "node:assert/strict";
import type { Request } from "express";
import { hasInstallableClient } from "./extension-install";

/** Minimal request carrying only the header hasInstallableClient reads. A bare
 * `{}` (no key) models a request that sent no User-Agent at all — the branch
 * supertest can't reproduce because it always sends one. */
function requestWithUserAgent(userAgent?: string): Request {
	const headers: Record<string, string | undefined> =
		userAgent === undefined ? {} : { "user-agent": userAgent };
	const fake = { headers } as Partial<Request>;
	return fake as Request;
}

const ANDROID_CHROME =
	"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";
const DESKTOP_SAFARI =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const DESKTOP_CHROME =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

describe("hasInstallableClient", () => {
	it("returns false for Android (Chrome/Firefox there can't install the extension)", () => {
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
