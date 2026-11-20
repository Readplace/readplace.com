import assert from "node:assert/strict";

import { signState, verifyState } from "./oauth-state";

const SECRET = "test-oauth-state-secret";

describe("verifyState", () => {
	it("returns the payload of a state it signed", () => {
		const signed = signState({ payload: "nonce-abc", secret: SECRET });
		assert.equal(verifyState({ signed, secret: SECRET }), "nonce-abc");
	});

	it("rejects a state with no signature separator", () => {
		assert.equal(verifyState({ signed: "no-separator", secret: SECRET }), null);
	});

	it("rejects a state whose signature is a different length", () => {
		assert.equal(verifyState({ signed: "nonce-abc.short", secret: SECRET }), null);
	});

	it("rejects a same-length state whose signature does not match", () => {
		const signed = signState({ payload: "nonce-abc", secret: SECRET });
		const mac = signed.slice(signed.lastIndexOf(".") + 1);
		assert.equal(verifyState({ signed: `nonce-abc.${"A".repeat(mac.length)}`, secret: SECRET }), null);
	});

	it("rejects a signature of the same character length but more bytes instead of throwing", () => {
		const signed = signState({ payload: "nonce-abc", secret: SECRET });
		const mac = signed.slice(signed.lastIndexOf(".") + 1);
		assert.equal(verifyState({ signed: `nonce-abc.${"é".repeat(mac.length)}`, secret: SECRET }), null);
	});
});
