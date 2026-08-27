import type { NextFunction, Request, Response } from "express";
import {
	EDGE_SECRET_HEADER,
	VIEWER_HOST_HEADER,
	VIEWER_IP_HEADER,
	viewerOf,
} from "./viewer-identity";
import { createViewerIdentityMiddleware } from "./viewer-identity.middleware";

const EDGE_SECRET = "s3cr3t-only-the-edge-knows";

function createReq(input: {
	ip?: string;
	headers?: Record<string, string | string[] | undefined>;
}): Partial<Request> {
	return { ip: input.ip, headers: input.headers ?? {} };
}

function resolve(input: {
	ip?: string;
	headers?: Record<string, string | string[] | undefined>;
	edgeSecret?: string;
}) {
	const req = createReq(input);
	let calls = 0;
	const next: NextFunction = () => {
		calls += 1;
	};
	createViewerIdentityMiddleware({ edgeSecret: input.edgeSecret ?? EDGE_SECRET })(
		req as Request,
		{} as Response,
		next,
	);
	return { identity: viewerOf(req as Request), nextCalls: calls };
}

describe("viewer identity without a trusted edge", () => {
	it("reads the address off the socket and the host off the Host header", () => {
		const { identity } = resolve({ ip: "203.0.113.9", headers: { host: "readplace.com" } });
		expect(identity).toEqual({ ip: "203.0.113.9", host: "readplace.com" });
	});

	it("reports no address when the socket has none", () => {
		const { identity } = resolve({ headers: { host: "readplace.com" } });
		expect(identity).toEqual({ ip: undefined, host: "readplace.com" });
	});

	it("reports no host when the request carries no Host header", () => {
		const { identity } = resolve({ ip: "203.0.113.9" });
		expect(identity).toEqual({ ip: "203.0.113.9", host: undefined });
	});

	it("passes the request on", () => {
		expect(resolve({ ip: "203.0.113.9" }).nextCalls).toBe(1);
	});
});

describe("viewer identity when the edge proves itself", () => {
	it("prefers the address and host the edge states over the connection it arrived on", () => {
		const { identity } = resolve({
			ip: "198.51.100.1",
			headers: {
				host: "d123.execute-api.ap-southeast-2.amazonaws.com",
				[EDGE_SECRET_HEADER]: EDGE_SECRET,
				[VIEWER_IP_HEADER]: "203.0.113.9",
				[VIEWER_HOST_HEADER]: "readplace.com",
			},
		});
		expect(identity).toEqual({ ip: "203.0.113.9", host: "readplace.com" });
	});

	it("keeps the connection's own values for whichever the edge did not state", () => {
		const { identity } = resolve({
			ip: "198.51.100.1",
			headers: { host: "origin.example", [EDGE_SECRET_HEADER]: EDGE_SECRET },
		});
		expect(identity).toEqual({ ip: "198.51.100.1", host: "origin.example" });
	});
});

describe("viewer identity when the edge cannot prove itself", () => {
	it("ignores a stated address carrying no secret at all", () => {
		const { identity } = resolve({
			ip: "198.51.100.1",
			headers: { host: "origin.example", [VIEWER_IP_HEADER]: "203.0.113.9" },
		});
		expect(identity).toEqual({ ip: "198.51.100.1", host: "origin.example" });
	});

	it("ignores a stated address whose secret is the wrong length", () => {
		const { identity } = resolve({
			ip: "198.51.100.1",
			headers: {
				host: "origin.example",
				[EDGE_SECRET_HEADER]: "short",
				[VIEWER_IP_HEADER]: "203.0.113.9",
			},
		});
		expect(identity).toEqual({ ip: "198.51.100.1", host: "origin.example" });
	});

	it("ignores a stated address whose secret is the right length but wrong", () => {
		const { identity } = resolve({
			ip: "198.51.100.1",
			headers: {
				host: "origin.example",
				[EDGE_SECRET_HEADER]: "X".repeat(EDGE_SECRET.length),
				[VIEWER_IP_HEADER]: "203.0.113.9",
			},
		});
		expect(identity).toEqual({ ip: "198.51.100.1", host: "origin.example" });
	});

	it("trusts nothing when this deployment holds no secret, whatever the request sends", () => {
		const { identity } = resolve({
			ip: "198.51.100.1",
			edgeSecret: "",
			headers: {
				host: "origin.example",
				[EDGE_SECRET_HEADER]: "anything",
				[VIEWER_IP_HEADER]: "203.0.113.9",
			},
		});
		expect(identity).toEqual({ ip: "198.51.100.1", host: "origin.example" });
	});

	it("ignores a repeated header, which arrives as a list rather than one stated value", () => {
		const { identity } = resolve({
			ip: "198.51.100.1",
			headers: {
				host: "origin.example",
				[EDGE_SECRET_HEADER]: [EDGE_SECRET, EDGE_SECRET],
				[VIEWER_IP_HEADER]: "203.0.113.9",
			},
		});
		expect(identity).toEqual({ ip: "198.51.100.1", host: "origin.example" });
	});

	it("rejects a secret whose characters match but whose bytes do not, rather than throwing", () => {
		const sameLengthDifferentBytes = "é".repeat(EDGE_SECRET.length);
		expect(sameLengthDifferentBytes.length).toBe(EDGE_SECRET.length);
		const { identity } = resolve({
			ip: "198.51.100.1",
			headers: {
				host: "origin.example",
				[EDGE_SECRET_HEADER]: sameLengthDifferentBytes,
				[VIEWER_IP_HEADER]: "203.0.113.9",
			},
		});
		expect(identity).toEqual({ ip: "198.51.100.1", host: "origin.example" });
	});

	it("ignores an empty stated address rather than adopting it as the viewer's", () => {
		const { identity } = resolve({
			ip: "198.51.100.1",
			headers: {
				host: "origin.example",
				[EDGE_SECRET_HEADER]: EDGE_SECRET,
				[VIEWER_IP_HEADER]: "",
				[VIEWER_HOST_HEADER]: "",
			},
		});
		expect(identity).toEqual({ ip: "198.51.100.1", host: "origin.example" });
	});
});

describe("reading the identity before it has been resolved", () => {
	it("fails loudly rather than reporting an anonymous viewer", () => {
		expect(() => viewerOf(createReq({ ip: "203.0.113.9" }) as Request)).toThrow(
			/viewer-identity middleware must run/,
		);
	});
});
