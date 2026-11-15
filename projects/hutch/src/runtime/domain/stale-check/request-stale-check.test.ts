import assert from "node:assert/strict";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import type { Logger } from "@packages/logger";
import type { EffectiveAccess } from "@packages/subscription-access";
import { initInMemoryRateLimit } from "@packages/test-fixtures/providers/rate-limit";
import { initRequestStaleCheck } from "./request-stale-check";

const NOW = new Date("2026-11-15T12:00:00.000Z");
const URL_A = "https://example.com/article";
const RULE = { limit: 1, windowSeconds: 86400 };

const ACCESS: Record<"founding" | "paid" | "trial" | "free", EffectiveAccess> = {
	founding: { tier: "founding", banner: "none" },
	paid: { tier: "paid", banner: "none" },
	trial: { tier: "trial", banner: "trial-countdown", trialEndsAt: "2026-11-20T00:00:00.000Z" },
	free: { tier: "free", banner: "free", reason: "trial-expired" },
};

function setup(params: { access: EffectiveAccess }) {
	const published: { url: string }[] = [];
	const infoLines: unknown[][] = [];
	const accessReads: UserId[] = [];
	const limiterCalls: string[] = [];
	const { consumeRateLimit } = initInMemoryRateLimit({ now: () => NOW });
	const logger: Logger = {
		info: (...args: unknown[]) => {
			infoLines.push(args);
		},
		error: () => {},
		warn: () => {},
		debug: () => {},
	};
	const { requestStaleCheck } = initRequestStaleCheck({
		consumeRateLimit: async (call) => {
			limiterCalls.push(`${call.bucket}#${call.key}`);
			return consumeRateLimit(call);
		},
		rule: RULE,
		publishStaleCheckRequested: async (event) => {
			published.push(event);
		},
		getEffectiveAccess: async (userId) => {
			accessReads.push(userId);
			return params.access;
		},
		logger,
	});
	return { requestStaleCheck, published, infoLines, accessReads, limiterCalls };
}

const userId = (raw: string): UserId => UserIdSchema.parse(raw);

describe("initRequestStaleCheck", () => {
	it.each(["founding", "paid", "trial"] as const)("publishes every check for a %s account without counting it", async (tier) => {
		const { requestStaleCheck, published, limiterCalls } = setup({ access: ACCESS[tier] });

		await requestStaleCheck({ url: URL_A, requester: { account: userId("user-1") } });
		await requestStaleCheck({ url: URL_A, requester: { account: userId("user-1") } });

		assert.deepEqual(published, [{ url: URL_A }, { url: URL_A }]);
		assert.deepEqual(limiterCalls, []);
	});

	it("publishes a free account's first check, then skips with a log once the allowance is spent", async () => {
		const { requestStaleCheck, published, infoLines, limiterCalls } = setup({ access: ACCESS.free });

		await requestStaleCheck({ url: URL_A, requester: { account: userId("user-1") } });
		await requestStaleCheck({ url: URL_A, requester: { account: userId("user-1") } });

		assert.deepEqual(published, [{ url: URL_A }]);
		assert.deepEqual(limiterCalls, ["stale-check-account#user-1", "stale-check-account#user-1"]);
		assert.deepEqual(infoLines, [
			["[stale-check] allowance spent", { bucket: "stale-check-account", retryAfterSeconds: 43200 }],
		]);
	});

	it("publishes a logged-out IP's first check, then skips, while another IP still publishes", async () => {
		const { requestStaleCheck, published, infoLines } = setup({ access: ACCESS.founding });

		await requestStaleCheck({ url: URL_A, requester: { ip: "203.0.113.1" } });
		await requestStaleCheck({ url: URL_A, requester: { ip: "203.0.113.1" } });
		await requestStaleCheck({ url: URL_A, requester: { ip: "203.0.113.2" } });

		assert.deepEqual(published, [{ url: URL_A }, { url: URL_A }]);
		assert.deepEqual(infoLines, [
			["[stale-check] allowance spent", { bucket: "stale-check-ip", retryAfterSeconds: 43200 }],
		]);
	});

	it("keeps the account and IP counters apart even when their keys are the same string", async () => {
		const { requestStaleCheck, published, limiterCalls } = setup({ access: ACCESS.free });

		await requestStaleCheck({ url: URL_A, requester: { account: userId("shared-key") } });
		await requestStaleCheck({ url: URL_A, requester: { ip: "shared-key" } });

		assert.deepEqual(published, [{ url: URL_A }, { url: URL_A }]);
		assert.deepEqual(limiterCalls, ["stale-check-account#shared-key", "stale-check-ip#shared-key"]);
	});

	it("never reads access for an IP requester", async () => {
		const { requestStaleCheck, accessReads } = setup({ access: ACCESS.free });

		await requestStaleCheck({ url: URL_A, requester: { ip: "203.0.113.1" } });

		assert.deepEqual(accessReads, []);
	});
});
