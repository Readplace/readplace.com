import assert from "node:assert/strict";
import { initResidentialEgress } from "./residential-egress";

const proxy = { server: "http://brd.superproxy.io:33335", username: "brd-customer-c1-zone-residential", password: "secret-pass" };

function counterTokens() {
	let count = 0;
	return () => {
		count += 1;
		return `token${count}`;
	};
}

describe("initResidentialEgress", () => {
	it("mints a fresh sticky session on the username for every render, leaving server and password unchanged", () => {
		const nextEgress = initResidentialEgress({ proxy, newSessionToken: counterTokens() });

		assert.deepEqual(nextEgress(), {
			kind: "residential",
			proxy: { server: "http://brd.superproxy.io:33335", username: "brd-customer-c1-zone-residential-session-token1", password: "secret-pass" },
		});
		assert.deepEqual(nextEgress(), {
			kind: "residential",
			proxy: { server: "http://brd.superproxy.io:33335", username: "brd-customer-c1-zone-residential-session-token2", password: "secret-pass" },
		});
	});

	it("refuses a base username that already carries a session", () => {
		assert.throws(
			() => initResidentialEgress({ proxy: { ...proxy, username: "brd-customer-c1-zone-residential-session-fixed" }, newSessionToken: counterTokens() }),
			{ message: "Residential proxy username must not carry a session: each render mints its own" },
		);
	});
});
