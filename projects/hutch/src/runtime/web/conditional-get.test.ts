import type { Request, Response } from "express";
import type { Component } from "./component.types";
import { sendConditionalHtml } from "./conditional-get";
import { HtmlPage } from "./html-page";

interface FakeResponse {
	statusCode: number;
	headers: Record<string, string>;
	body: string;
	ended: boolean;
}

function fakeRes(): { res: Response; result: FakeResponse } {
	const result: FakeResponse = {
		statusCode: 200,
		headers: {},
		body: "",
		ended: false,
	};
	const res: Partial<Response> = {
		setHeader: (name: string, value: string | number | readonly string[]) => {
			result.headers[name.toLowerCase()] = String(value);
			return res as Response;
		},
		set: (field: string | Record<string, string>) => {
			if (typeof field === "object") {
				for (const [k, v] of Object.entries(field)) {
					result.headers[k.toLowerCase()] = v;
				}
			}
			return res as Response;
		},
		status: (code: number) => {
			result.statusCode = code;
			return res as Response;
		},
		send: (body: string) => {
			result.body = body;
			result.ended = true;
			return res as Response;
		},
		end: () => {
			result.ended = true;
			return res as Response;
		},
	};
	return { res: res as Response, result };
}

function fakeReq(headers: Record<string, string> = {}): Request {
	return { headers } as unknown as Request;
}

function htmlComponent(body: string): Component {
	return HtmlPage(body);
}

describe("sendConditionalHtml", () => {
	it("emits a 200 with the body and a weak ETag on the first request", () => {
		const { res, result } = fakeRes();

		sendConditionalHtml(fakeReq(), res, htmlComponent("<p>hi</p>"));

		expect(result.statusCode).toBe(200);
		expect(result.body).toBe("<p>hi</p>");
		const etag = result.headers.etag;
		expect(etag).toMatch(/^W\/".+"$/);
	});

	it("returns 304 with no body when the request If-None-Match matches the freshly-computed ETag", () => {
		const body = "<p>hi</p>";
		const { res: firstRes, result: firstResult } = fakeRes();
		sendConditionalHtml(fakeReq(), firstRes, htmlComponent(body));
		const etag = firstResult.headers.etag;

		const { res: secondRes, result: secondResult } = fakeRes();
		sendConditionalHtml(
			fakeReq({ "if-none-match": etag }),
			secondRes,
			htmlComponent(body),
		);

		expect(secondResult.statusCode).toBe(304);
		expect(secondResult.body).toBe("");
		expect(secondResult.ended).toBe(true);
		expect(secondResult.headers.etag).toBe(etag);
	});

	it("re-renders 200 with a fresh ETag when the body changes (the title settled, the saved-article row is no longer the hostname stub)", () => {
		const { res: firstRes, result: firstResult } = fakeRes();
		sendConditionalHtml(
			fakeReq(),
			firstRes,
			htmlComponent("<h1>medium.com</h1>"),
		);
		const oldEtag = firstResult.headers.etag;

		const { res: secondRes, result: secondResult } = fakeRes();
		sendConditionalHtml(
			fakeReq({ "if-none-match": oldEtag }),
			secondRes,
			htmlComponent("<h1>Why Rust beats Go</h1>"),
		);

		expect(secondResult.statusCode).toBe(200);
		expect(secondResult.body).toBe("<h1>Why Rust beats Go</h1>");
		expect(secondResult.headers.etag).not.toBe(oldEtag);
	});

	it("forces revalidation on every poll via Cache-Control: private, no-cache so a freshly-settled article does not wait for a TTL", () => {
		const { res, result } = fakeRes();

		sendConditionalHtml(fakeReq(), res, htmlComponent("<p>hi</p>"));

		expect(result.headers["cache-control"]).toBe("private, no-cache");
	});

	it("computes the same ETag for identical bodies across calls so the in-flight steady-state polls collapse to 304", () => {
		const { result: first } = (() => {
			const r = fakeRes();
			sendConditionalHtml(fakeReq(), r.res, htmlComponent("<p>same</p>"));
			return r;
		})();
		const { result: second } = (() => {
			const r = fakeRes();
			sendConditionalHtml(fakeReq(), r.res, htmlComponent("<p>same</p>"));
			return r;
		})();

		expect(first.headers.etag).toBe(second.headers.etag);
	});
});
