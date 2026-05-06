import type { Response } from "express";
import type { Component } from "./component.types";
import { HtmlPage } from "./html-page";
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

describe("sendComponent", () => {
	it("passes the component's statusCode, headers, and body through to the response", () => {
		const { calls, res } = createFakeResponse();

		sendComponent(res, HtmlPage("<p>Hello</p>"));

		expect(calls.status).toEqual([200]);
		expect(calls.set).toEqual([{ "content-type": "text/html; charset=utf-8" }]);
		expect(calls.send).toEqual(["<p>Hello</p>"]);
	});

	it("uses the statusCode that the component carries", () => {
		const { calls, res } = createFakeResponse();

		sendComponent(res, HtmlPage("<p>Not found</p>", 404));

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

		sendComponent(res, siren);

		expect(calls.status).toEqual([201]);
		expect(calls.set).toEqual([{ "content-type": "application/vnd.siren+json" }]);
		expect(calls.send).toEqual(['{"class":["article"]}']);
	});
});
