import assert from "node:assert/strict";
import { hasGmailScope } from "./gmail-scope";

const METADATA = "https://www.googleapis.com/auth/gmail.metadata";
const READONLY = "https://www.googleapis.com/auth/gmail.readonly";
const SETTINGS = "https://www.googleapis.com/auth/gmail.settings.basic";

describe("hasGmailScope", () => {
	it("finds a scope among the space-separated scopes Google granted", () => {
		assert.equal(hasGmailScope({ grantedScope: `${SETTINGS} ${READONLY}`, scope: READONLY }), true);
	});

	it("reports a scope Google did not grant as missing", () => {
		assert.equal(hasGmailScope({ grantedScope: `${SETTINGS} ${METADATA}`, scope: READONLY }), false);
	});

	it("reports every scope as missing when no grant is recorded", () => {
		assert.equal(hasGmailScope({ grantedScope: undefined, scope: METADATA }), false);
	});

	it("does not mistake a scope that merely starts with another for a grant of it", () => {
		assert.equal(hasGmailScope({ grantedScope: `${METADATA}.extra`, scope: METADATA }), false);
	});
});
