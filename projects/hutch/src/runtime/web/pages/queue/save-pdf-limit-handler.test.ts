import type { NextFunction, Request, Response } from "express";
import { initSavePdfLimitHandler } from "./save-pdf-limit-handler";

type FakeJsonCalls = { status?: number; body?: unknown; type?: string };

function fakeResponse(): {
	res: Response;
	calls: FakeJsonCalls;
} {
	const calls: FakeJsonCalls = {};
	const res = {
		status(s: number) { calls.status = s; return res; },
		type(t: string) { calls.type = t; return res; },
		json(body: unknown) { calls.body = body; return res; },
	} as unknown as Response;
	return { res, calls };
}

function fakeRequest(headers: Record<string, string>): Request {
	return {
		headers,
		get(name: string) { return headers[name.toLowerCase()]; },
		accepts(_type: string) {
			const accept = headers.accept ?? "";
			return accept.includes("application/vnd.siren+json")
				? "application/vnd.siren+json"
				: false;
		},
	} as unknown as Request;
}

describe("initSavePdfLimitHandler", () => {
	it("intercepts entity.too.large errors at the configured limit and emits a Siren error with a save-article fallback action", () => {
		const handler = initSavePdfLimitHandler({
			logError: () => {},
			maxBytes: 1024,
		});
		const { res, calls } = fakeResponse();
		const next: NextFunction = jest.fn();

		handler(
			Object.assign(new Error("too big"), { type: "entity.too.large", limit: 1024 }),
			fakeRequest({ accept: "application/vnd.siren+json" }),
			res,
			next,
		);

		expect(calls.status).toBe(422);
		expect(calls.type).toBe("application/vnd.siren+json");
		expect(calls.body).toEqual(expect.objectContaining({
			class: ["error"],
			properties: expect.objectContaining({ code: "pdf-too-large" }),
		}));
		const body = calls.body as { actions: { name: string; href: string }[] };
		expect(body.actions[0]).toEqual(
			expect.objectContaining({ name: "save-article", href: "/queue" }),
		);
		expect(next).not.toHaveBeenCalled();
	});

	it("forwards non-payload errors via next()", () => {
		const handler = initSavePdfLimitHandler({
			logError: () => {},
			maxBytes: 1024,
		});
		const { res, calls } = fakeResponse();
		const next: NextFunction = jest.fn();
		const unrelatedError = new Error("not a payload");

		handler(unrelatedError, fakeRequest({ accept: "application/vnd.siren+json" }), res, next);

		expect(next).toHaveBeenCalledWith(unrelatedError);
		expect(calls.status).toBeUndefined();
	});

	it("forwards payload errors whose limit does not match this handler's limit", () => {
		const handler = initSavePdfLimitHandler({
			logError: () => {},
			maxBytes: 1024,
		});
		const { res, calls } = fakeResponse();
		const next: NextFunction = jest.fn();

		handler(
			Object.assign(new Error("too big"), { type: "entity.too.large", limit: 9999 }),
			fakeRequest({ accept: "application/vnd.siren+json" }),
			res,
			next,
		);

		expect(next).toHaveBeenCalled();
		expect(calls.status).toBeUndefined();
	});

	it("forwards entity.too.large when the client does not accept Siren so the next handler can render a non-Siren response", () => {
		const handler = initSavePdfLimitHandler({
			logError: () => {},
			maxBytes: 1024,
		});
		const { res, calls } = fakeResponse();
		const next: NextFunction = jest.fn();

		handler(
			Object.assign(new Error("too big"), { type: "entity.too.large", limit: 1024 }),
			fakeRequest({ accept: "text/html" }),
			res,
			next,
		);

		expect(next).toHaveBeenCalled();
		expect(calls.status).toBeUndefined();
	});

	it("logs the size violation through the injected logError so it lands on the alarm path", () => {
		const logged: { message: string; error?: Error }[] = [];
		const handler = initSavePdfLimitHandler({
			logError: (message, error) => { logged.push({ message, error }); },
			maxBytes: 1024,
		});
		const { res } = fakeResponse();
		const next: NextFunction = jest.fn();
		const err = Object.assign(new Error("too big"), { type: "entity.too.large", limit: 1024 });

		handler(err, fakeRequest({ accept: "application/vnd.siren+json" }), res, next);

		expect(logged).toHaveLength(1);
		expect(logged[0]?.message).toContain("save-pdf request body exceeded");
		expect(logged[0]?.error).toBe(err);
	});

	it("does not pass an Error to logError when the body-parser hands over a non-Error payload", () => {
		const logged: { message: string; error?: Error }[] = [];
		const handler = initSavePdfLimitHandler({
			logError: (message, error) => { logged.push({ message, error }); },
			maxBytes: 1024,
		});
		const { res } = fakeResponse();
		const next: NextFunction = jest.fn();
		const err = { type: "entity.too.large", limit: 1024 };

		handler(err, fakeRequest({ accept: "application/vnd.siren+json" }), res, next);

		expect(logged).toHaveLength(1);
		expect(logged[0]?.error).toBeUndefined();
	});
});
