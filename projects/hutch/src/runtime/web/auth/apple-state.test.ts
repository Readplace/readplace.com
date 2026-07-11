import { MAX_APPLE_STATE_COOKIE_BYTES, signAppleState } from "./apple-state";
import { verifyState } from "./oauth-state";

const SECRET = "test-apple-state-secret";

function payloadOf(signed: string): Record<string, unknown> {
	const verified = verifyState({ signed, secret: SECRET });
	if (verified === null) throw new Error("signed state failed verification");
	return JSON.parse(verified);
}

describe("signAppleState", () => {
	const base = { nonce: "abc", returnUrl: undefined, createdAt: 1700000000000 };

	it("omits lastViewUrl entirely when there is none to tunnel", () => {
		const signed = signAppleState({ payload: base, lastViewUrl: undefined, secret: SECRET });
		expect(payloadOf(signed).lastViewUrl).toBeUndefined();
	});

	it("tunnels a normal-length lastViewUrl into the signed state", () => {
		const url = "https://example.com/post";
		const signed = signAppleState({ payload: base, lastViewUrl: url, secret: SECRET });
		expect(payloadOf(signed).lastViewUrl).toBe(url);
		expect(Buffer.byteLength(encodeURIComponent(signed))).toBeLessThanOrEqual(MAX_APPLE_STATE_COOKIE_BYTES);
	});

	it("drops the lastViewUrl (degrading to no autosave) when tunneling it would overflow the cookie budget", () => {
		const hugeUrl = `https://example.com/${"a".repeat(MAX_APPLE_STATE_COOKIE_BYTES + 200)}`;
		const signed = signAppleState({ payload: base, lastViewUrl: hugeUrl, secret: SECRET });
		expect(payloadOf(signed).lastViewUrl).toBeUndefined();
		// The other load-bearing fields survive so sign-in still works.
		expect(payloadOf(signed).nonce).toBe("abc");
	});
});
