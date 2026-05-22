import assert from "node:assert/strict";
import request from "supertest";
import { useTestServer } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();

describe("GET /e2e/fixtures/pdf/:id.pdf", () => {
	it("returns 200 application/pdf for any :id", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/e2e/fixtures/pdf/12345.pdf")
			.buffer(true)
			.parse((res, callback) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => callback(null, Buffer.concat(chunks)));
			});
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/application\/pdf/);
	});

	it("returns identical bytes regardless of :id (uniqueness lives in the URL, not the content)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const parsePdf = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
			const chunks: Buffer[] = [];
			res.on("data", (chunk: Buffer) => chunks.push(chunk));
			res.on("end", () => cb(null, Buffer.concat(chunks)));
		};
		const a = await request(harness.server).get("/e2e/fixtures/pdf/run-a.pdf").buffer(true).parse(parsePdf);
		const b = await request(harness.server).get("/e2e/fixtures/pdf/run-b.pdf").buffer(true).parse(parsePdf);
		assert(Buffer.isBuffer(a.body), "response body must be a Buffer");
		assert(Buffer.isBuffer(b.body), "response body must be a Buffer");
		expect(a.body.equals(b.body)).toBe(true);
	});

	it("serves a spec-compliant PDF starting with %PDF-1.4", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/e2e/fixtures/pdf/sample.pdf")
			.buffer(true)
			.parse((res, cb) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => cb(null, Buffer.concat(chunks)));
			});
		assert(Buffer.isBuffer(response.body), "response body must be a Buffer");
		expect(response.body.toString("binary", 0, 8)).toBe("%PDF-1.4");
	});
});
