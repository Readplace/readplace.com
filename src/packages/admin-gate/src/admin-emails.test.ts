import assert from "node:assert/strict";
import { parseAdminEmails } from "./admin-emails";

describe("parseAdminEmails", () => {
	it("splits the comma-separated list and trims each address", () => {
		assert.deepEqual(parseAdminEmails(" a@example.com, b@example.com "), ["a@example.com", "b@example.com"]);
	});

	it("drops empty entries", () => {
		assert.deepEqual(parseAdminEmails(",a@example.com,, ,"), ["a@example.com"]);
	});

	it("reads an empty value as no admins", () => {
		assert.deepEqual(parseAdminEmails(""), []);
	});
});
