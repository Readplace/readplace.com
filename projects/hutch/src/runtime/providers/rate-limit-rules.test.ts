import assert from "node:assert/strict";
import { formatEnvMap } from "./env-map";
import { parseRateLimitRules } from "./rate-limit-rules";

const RULES = {
	viewCrawl: "20/3600",
	viewCrawlSignedIn: "200/3600",
	login: "10/900",
	loginAccount: "5/900",
	signup: "10/3600",
	forgotPassword: "5/3600",
	oauthRegister: "10/3600",
	oauthToken: "60/3600",
	browserHandoff: "600/3600",
	import: "10/3600",
	importFromUrl: "5/3600",
};

describe("parseRateLimitRules", () => {
	it("parses every rule from the env map", () => {
		const rules = parseRateLimitRules(formatEnvMap(RULES));

		assert.deepEqual(rules.browserHandoff, { limit: 600, windowSeconds: 3600 });
		assert.deepEqual(rules.loginAccount, { limit: 5, windowSeconds: 900 });
		assert.deepEqual(Object.keys(rules).sort(), Object.keys(RULES).sort());
	});

	it("rejects a map missing a rule", () => {
		const { oauthToken: _oauthToken, ...missing } = RULES;
		assert.throws(() => parseRateLimitRules(formatEnvMap(missing)), /oauthToken/);
	});

	it("rejects a rule the app does not read", () => {
		assert.throws(() => parseRateLimitRules(formatEnvMap({ ...RULES, staleRule: "1/60" })), /staleRule/);
	});

	it("rejects a malformed rule", () => {
		assert.throws(() => parseRateLimitRules(formatEnvMap({ ...RULES, signup: "ten" })), /got: ten/);
	});
});
