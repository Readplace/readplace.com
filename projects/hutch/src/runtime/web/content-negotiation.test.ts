import type { Request } from "express";
import { wantsMarkdown, wantsSiren } from "./content-negotiation";

function requestWithAccept(accept: string): Request {
	return { get: (header: string) => header === "Accept" ? accept : undefined } as unknown as Request;
}

describe("wantsSiren", () => {
	it("returns true when Accept header includes the Siren media type", () => {
		const req = requestWithAccept("application/vnd.siren+json");

		expect(wantsSiren(req)).toBe(true);
	});

	it("returns true when Siren is among multiple accepted types", () => {
		const req = requestWithAccept("text/html, application/vnd.siren+json");

		expect(wantsSiren(req)).toBe(true);
	});

	it("returns false for a plain HTML accept header", () => {
		const req = requestWithAccept("text/html");

		expect(wantsSiren(req)).toBe(false);
	});

	it("returns false when no Accept header is present", () => {
		const req = { get: () => undefined } as unknown as Request;

		expect(wantsSiren(req)).toBe(false);
	});
});

describe("wantsMarkdown", () => {
	it("returns true when Accept header is text/markdown", () => {
		const req = requestWithAccept("text/markdown");

		expect(wantsMarkdown(req)).toBe(true);
	});

	it("returns true when text/markdown is among multiple accepted types", () => {
		const req = requestWithAccept("text/markdown, text/html;q=0.5");

		expect(wantsMarkdown(req)).toBe(true);
	});

	it("returns false for a plain HTML accept header", () => {
		const req = requestWithAccept("text/html");

		expect(wantsMarkdown(req)).toBe(false);
	});

	it("returns false when no Accept header is present", () => {
		const req = { get: () => undefined } as unknown as Request;

		expect(wantsMarkdown(req)).toBe(false);
	});
});
