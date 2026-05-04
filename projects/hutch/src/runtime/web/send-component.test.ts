import type { Request, Response } from "express";
import type { Component } from "./component.types";
import { HtmlPage } from "./html-page";
import { MarkdownPage } from "./markdown-page";
import { sendComponent } from "./send-component";

interface FakeResponse {
	calls: { status: number[]; set: Record<string, string>[]; send: unknown[] };
	res: Response;
}

function createFakeResponse(): FakeResponse {
	const calls: FakeResponse["calls"] = { status: [], set: [], send: [] };
	const res = {
		status(code: number) {
			calls.status.push(code);
			return res;
		},
		set(headers: Record<string, string>) {
			calls.set.push(headers);
			return res;
		},
		send(body: unknown) {
			calls.send.push(body);
			return res;
		},
	} as unknown as Response;
	return { calls, res };
}

function requestWithAccept(accept?: string): Request {
	return { get: (header: string) => header === "Accept" ? accept : undefined } as unknown as Request;
}

describe("sendComponent", () => {
	it("passes the component's statusCode, headers, and body through to the response", () => {
		const { calls, res } = createFakeResponse();

		sendComponent(requestWithAccept(), res, HtmlPage("<p>Hello</p>"));

		expect(calls.status).toEqual([200]);
		expect(calls.set).toEqual([{ "content-type": "text/html; charset=utf-8" }]);
		expect(calls.send).toEqual(["<p>Hello</p>"]);
	});

	it("uses the statusCode that the component carries", () => {
		const { calls, res } = createFakeResponse();

		sendComponent(requestWithAccept(), res, HtmlPage("<p>Not found</p>", 404));

		expect(calls.status).toEqual([404]);
		expect(calls.set).toEqual([{ "content-type": "text/html; charset=utf-8" }]);
		expect(calls.send).toEqual(["<p>Not found</p>"]);
	});

	it("forwards the headers that a custom component returns", () => {
		const { calls, res } = createFakeResponse();
		const siren: Component = {
			to: () => ({
				statusCode: 201,
				headers: { "content-type": "application/vnd.siren+json" },
				body: '{"class":["article"]}',
			}),
		};

		sendComponent(requestWithAccept(), res, siren);

		expect(calls.status).toEqual([201]);
		expect(calls.set).toEqual([{ "content-type": "application/vnd.siren+json" }]);
		expect(calls.send).toEqual(['{"class":["article"]}']);
	});

	it("returns the markdown branch when Accept is text/markdown and the component supports it", () => {
		const { calls, res } = createFakeResponse();

		sendComponent(requestWithAccept("text/markdown"), res, MarkdownPage("# Hi"));

		expect(calls.status).toEqual([200]);
		expect(calls.set[0]["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(calls.send).toEqual(["# Hi"]);
	});

	it("falls back to text/html when the component returns 406 for the markdown branch", () => {
		const { calls, res } = createFakeResponse();

		sendComponent(requestWithAccept("text/markdown"), res, HtmlPage("<p>Hi</p>"));

		expect(calls.status).toEqual([200]);
		expect(calls.set[0]["content-type"]).toBe("text/html; charset=utf-8");
		expect(calls.send).toEqual(["<p>Hi</p>"]);
	});
});
