import type { Request } from "express";
import { wantsSiren } from "./content-negotiation";

function requestWithAccept(accept: string): Request {
	const types = accept.split(",").map(entry => {
		const [type, ...params] = entry.trim().split(";");
		const qParam = params.find(p => p.trim().startsWith("q="));
		const q = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
		return { type: type.trim(), q };
	});
	return {
		get: (header: string) => header === "Accept" ? accept : undefined,
		accepts: (...args: string[]) => {
			for (const candidate of args.flat()) {
				const match = types.find(t => t.type === candidate);
				if (match && match.q > 0) return candidate;
			}
			return false;
		},
	} as unknown as Request;
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

	it("returns false when Siren has quality 0", () => {
		const req = requestWithAccept("application/vnd.siren+json;q=0, text/html");

		expect(wantsSiren(req)).toBe(false);
	});

	it("returns false when no Accept header is present", () => {
		const req = { get: () => undefined, accepts: () => false } as unknown as Request;

		expect(wantsSiren(req)).toBe(false);
	});
});
