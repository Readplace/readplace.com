import { z } from "zod";
import { parseRateLimitRule } from "@packages/domain/rate-limit";
import type { RateLimitRules } from "@packages/provider-contracts/rate-limit";
import { parseEnvMap } from "./env-map";

const Rule = z.string().transform(parseRateLimitRule);

const RateLimitRulesSchema = z.strictObject({
	viewCrawl: Rule,
	viewCrawlSignedIn: Rule,
	login: Rule,
	loginAccount: Rule,
	signup: Rule,
	forgotPassword: Rule,
	oauthRegister: Rule,
	oauthToken: Rule,
	browserHandoff: Rule,
	import: Rule,
	importFromUrl: Rule,
} satisfies Record<keyof RateLimitRules, typeof Rule>);

export function parseRateLimitRules(raw: string): RateLimitRules {
	return RateLimitRulesSchema.parse(parseEnvMap(raw));
}
