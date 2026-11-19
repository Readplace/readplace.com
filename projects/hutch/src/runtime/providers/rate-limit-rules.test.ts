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
	forgotPasswordAccount: "5/86400",
	oauthRegister: "10/3600",
	oauthToken: "60/3600",
	browserHandoff: "600/3600",
	import: "10/3600",
	importFromUrl: "5/3600",
	uploadStage: "20/3600",
	dailySaves: "28/86400",
	mcpCall: "269/86400",
	bookUpload: "9/86400",
	staleCheck: "158/86400",
	export: "3/86400",
	signupCreated: "3/86400",
};

describe("parseRateLimitRules", () => {
	it("parses every rule from the env map", () => {
		const rules = parseRateLimitRules(formatEnvMap(RULES));

		assert.deepEqual(rules.browserHandoff, { limit: 600, windowSeconds: 3600 });
		assert.deepEqual(rules.loginAccount, { limit: 5, windowSeconds: 900 });
		assert.deepEqual(rules.forgotPasswordAccount, { limit: 5, windowSeconds: 86400 });
		assert.deepEqual(rules.uploadStage, { limit: 20, windowSeconds: 3600 });
		assert.deepEqual(rules.dailySaves, { limit: 28, windowSeconds: 86400 });
		assert.deepEqual(rules.mcpCall, { limit: 269, windowSeconds: 86400 });
		assert.deepEqual(rules.bookUpload, { limit: 9, windowSeconds: 86400 });
		assert.deepEqual(rules.staleCheck, { limit: 158, windowSeconds: 86400 });
		assert.deepEqual(rules.export, { limit: 3, windowSeconds: 86400 });
		assert.deepEqual(rules.signupCreated, { limit: 3, windowSeconds: 86400 });
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
