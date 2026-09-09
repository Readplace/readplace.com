import assert from "node:assert/strict";
import { GmailAccountEmailSchema } from "./gmail-account-email.schema";

describe("GmailAccountEmailSchema", () => {
	it("brands a Google account address", () => {
		assert.equal(GmailAccountEmailSchema.parse("reader@gmail.com"), "reader@gmail.com");
	});
});
