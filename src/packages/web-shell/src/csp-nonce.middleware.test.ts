import type { NextFunction, Request, Response } from "express";
import {
	createCspNonceMiddleware,
	generateCspNonce,
	requireCspNonce,
} from "./csp-nonce.middleware";

function createReq(): Request {
	return {} as unknown as Request;
}

const NO_RES = {} as unknown as Response;

describe("generateCspNonce", () => {
	it("mints a base64url value with no character a CSP source expression or an HTML attribute has to escape", () => {
		expect(generateCspNonce()).toMatch(/^[A-Za-z0-9_-]{22}$/);
	});

	it("mints a different value on every call so one page's nonce never authorises another's", () => {
		const nonces = new Set(Array.from({ length: 100 }, () => String(generateCspNonce())));
		expect(nonces.size).toBe(100);
	});
});

describe("createCspNonceMiddleware", () => {
	it("stamps the generated nonce on the request and continues the chain", () => {
		const nonce = generateCspNonce();
		const req = createReq();
		let nexted = false;
		const next: NextFunction = () => {
			nexted = true;
		};

		createCspNonceMiddleware({ generateCspNonce: () => nonce })(req, NO_RES, next);

		expect(req.cspNonce).toBe(nonce);
		expect(nexted).toBe(true);
	});

	it("stamps a fresh nonce per request", () => {
		const middleware = createCspNonceMiddleware({ generateCspNonce });
		const first = createReq();
		const second = createReq();

		middleware(first, NO_RES, () => {});
		middleware(second, NO_RES, () => {});

		expect(first.cspNonce).not.toBe(second.cspNonce);
	});
});

describe("requireCspNonce", () => {
	it("narrows the request's optional nonce to the value the middleware stamped", () => {
		const nonce = generateCspNonce();
		expect(requireCspNonce({ cspNonce: nonce })).toBe(nonce);
	});

	it("fails loudly when the middleware has not run, rather than rendering an unnonced script", () => {
		expect(() => requireCspNonce({})).toThrow(
			"the CSP nonce middleware must run before a page renders",
		);
	});
});
