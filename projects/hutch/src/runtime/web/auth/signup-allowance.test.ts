import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { initInMemoryRateLimit } from "@packages/test-fixtures/providers/rate-limit";
import { createViewerIdentityMiddleware } from "@packages/viewer-identity";
import { initClaimSignupAllowance, signupAllowanceSpentMessage } from "./signup-allowance";

const resolveViewerIdentity = createViewerIdentityMiddleware({ edgeSecret: "allowance-edge-secret" });

function requestFrom(ip?: string): Request {
	const req: Partial<Request> = { ip, headers: {} };
	resolveViewerIdentity(req as Request, {} as Response, jest.fn());
	return req as Request;
}

const THREE_A_DAY = { limit: 3, windowSeconds: 86400 };
const TUESDAY_9PM_UTC = Date.UTC(2026, 10, 17, 21, 0, 0);

function claimAt(nowMs: number) {
	const { consumeRateLimit } = initInMemoryRateLimit({ now: () => new Date(nowMs) });
	return initClaimSignupAllowance({ consumeRateLimit, rule: THREE_A_DAY });
}

describe("initClaimSignupAllowance", () => {
	it("allows three accounts from one network and refuses the fourth until 00:00 UTC", async () => {
		const claim = claimAt(TUESDAY_9PM_UTC);
		const req = requestFrom("203.0.113.9");

		const decisions = [await claim(req), await claim(req), await claim(req), await claim(req)];

		assert.deepEqual(decisions, [
			{ allowed: true },
			{ allowed: true },
			{ allowed: true },
			{ allowed: false, retryAfterSeconds: 3 * 3600 },
		]);
	});

	it("counts each network separately", async () => {
		const claim = claimAt(TUESDAY_9PM_UTC);
		const spent = requestFrom("203.0.113.9");
		await claim(spent);
		await claim(spent);
		await claim(spent);

		assert.deepEqual(await claim(requestFrom("198.51.100.4")), { allowed: true });
	});

	it("puts requests without a resolvable address on one shared allowance", async () => {
		const claim = claimAt(TUESDAY_9PM_UTC);
		await claim(requestFrom());
		await claim(requestFrom());
		await claim(requestFrom());

		assert.deepEqual(await claim(requestFrom()), { allowed: false, retryAfterSeconds: 3 * 3600 });
	});
});

describe("signupAllowanceSpentMessage", () => {
	it("names the configured limit", () => {
		assert.equal(
			signupAllowanceSpentMessage({ limit: 3 }),
			"This network has reached today's limit of 3 new Readplace accounts. Sign in to an account you already have, or try again tomorrow.",
		);
		assert.match(signupAllowanceSpentMessage({ limit: 5000 }), /limit of 5000 new/);
	});
});
