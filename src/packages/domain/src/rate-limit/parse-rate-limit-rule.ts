import assert from "node:assert";
import type { RateLimitRule } from "./fixed-window";

const RULE_PATTERN = /^([1-9]\d*)\/([1-9]\d*)$/;

/**
 * Parse a `"<limit>/<windowSeconds>"` rule string (e.g. `"30/3600"` = 30
 * requests per hour). The string form keeps each limit and its window a single
 * atomic configuration value, so the two numbers cannot drift apart across
 * separate environment variables.
 */
export function parseRateLimitRule(raw: string): RateLimitRule {
	const match = RULE_PATTERN.exec(raw);
	assert(
		match,
		`Rate-limit rule must be "<limit>/<windowSeconds>" with positive integers (e.g. "30/3600"), got: ${raw}`,
	);
	return {
		limit: Number.parseInt(match[1], 10),
		windowSeconds: Number.parseInt(match[2], 10),
	};
}
