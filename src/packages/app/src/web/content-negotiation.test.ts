import type { Request } from "express";
import { wantsSiren } from "./content-negotiation";

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
