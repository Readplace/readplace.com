import assert from "node:assert/strict";
import { checkNewsletterFrom } from "./newsletter-from-check";

describe("checkNewsletterFrom", () => {
	it.each([
		["Newsletter+Weekly@Example.com", "newsletter+weekly@example.com"],
		[" *@Example.COM ", "*@example.com"],
	])("accepts %j as %s", (candidate, expected) => {
		assert.deepEqual(checkNewsletterFrom(candidate), { ok: true, from: expected });
	});

	it.each([
		"news*@example.com",
		"*news@example.com",
		"**@example.com",
		"*@*.example.com",
		"*@example.*",
		"*.example.com",
		" News*@Example.com ",
	])("refuses %j because the * is not the whole name before the @", (candidate) => {
		assert.deepEqual(checkNewsletterFrom(candidate), { ok: false, reason: "unsupported-wildcard" });
	});

	it.each(["*", "*@", "*@example", "*@example.", "*@exa mple.com", "newsletter@localhost", "not an address", ""])(
		"refuses %j as not a FROM address, leaving the * out of it",
		(candidate) => {
			assert.deepEqual(checkNewsletterFrom(candidate), { ok: false, reason: "invalid" });
		},
	);
});
