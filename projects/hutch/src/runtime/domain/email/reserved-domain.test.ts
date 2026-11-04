import assert from "node:assert/strict";
import { reservedDomainOf } from "./reserved-domain";

describe("reservedDomainOf", () => {
	it("names a reserved example domain", () => {
		assert.equal(reservedDomainOf("a@example.com"), "example.com");
	});

	it("names a domain under a reserved top-level domain", () => {
		assert.equal(reservedDomainOf("a@host.test"), "host.test");
	});

	it("names nothing for a deliverable domain", () => {
		assert.equal(reservedDomainOf("a@readplace.com"), undefined);
	});
});
