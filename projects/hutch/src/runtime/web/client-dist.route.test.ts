import request from "supertest";
import { createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../test-app";
import { READER_PAINT_DELAY_MS } from "./shared/reader-open/reader-open-timing";
import { OFFLINE_READER_WORKER_PATH } from "./static-asset-paths";

const useApp = useTestServer();

describe("client-dist htmx bundle", () => {
	it("serves htmx as htmx's own classic script, whose top-level var is the only thing that makes window.htmx exist", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));

		const response = await request(harness.server).get("/client-dist/htmx.client.js");

		expect(response.status).toBe(200);
		expect(response.text.startsWith("var htmx=(function(")).toBe(true);
	});

	it("points at a source map", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));

		const response = await request(harness.server).get("/client-dist/htmx.client.js");

		expect(response.text).toContain("//# sourceMappingURL=htmx.client.js.map");
	});

	it("serves the source map it points at, so the devtools fetch is a 200 rather than an errors-table row", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));

		const response = await request(harness.server).get("/client-dist/htmx.client.js.map");

		expect(response.status).toBe(200);
		expect(response.body.version).toBe(3);
	});
});

describe("client-dist reader-open bundle", () => {
	it("serves the reader-open client with its composition-root footer", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));

		const response = await request(harness.server).get("/client-dist/reader-open.client.js");

		expect(response.status).toBe(200);
		expect(response.text).toContain("ReaderOpen.initReaderOpen({");
	});

	it("arms the shipped bundle with the reader paint delay, so the build script cannot drift from the constant", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));

		const response = await request(harness.server).get("/client-dist/reader-open.client.js");

		expect(response.text).toContain(`paintDelayMs: ${READER_PAINT_DELAY_MS},`);
	});

	it("serves the reader-open source map so the devtools fetch is a 200", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));

		const response = await request(harness.server).get("/client-dist/reader-open.client.js.map");

		expect(response.status).toBe(200);
		expect(response.body.version).toBe(3);
	});
});

describe("client-dist offline reader bundles", () => {
	it("lets the offline worker control the readlist although its script lives under /client-dist", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));

		const response = await request(harness.server).get(OFFLINE_READER_WORKER_PATH);

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("text/javascript; charset=utf-8");
		expect(response.headers["service-worker-allowed"]).toBe("/");
		expect(response.text).toContain("OfflineReaderWorker.initOfflineReaderWorker({");
		expect(response.text).toContain("networkTimeoutMs: 3000");
	});

	it("widens the scope of the worker script only, never of another bundle", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));

		const response = await request(harness.server).get("/client-dist/offline-reader.client.js");

		expect(response.status).toBe(200);
		expect(response.headers["service-worker-allowed"]).toBeUndefined();
	});

	it("has the browser check the worker script with the server every time, while every other bundle keeps its five-minute cache", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));

		const worker = await request(harness.server).get(OFFLINE_READER_WORKER_PATH);
		const registration = await request(harness.server).get("/client-dist/offline-reader.client.js");

		expect(worker.headers["cache-control"]).toBe("no-cache");
		expect(registration.headers["cache-control"]).toBe("public, max-age=300");
	});

	it("registers the worker only in a browser that offers service workers, which the app's web view does not", async () => {
		const harness = useApp(createDefaultTestAppFixture("https://readplace.com"));

		const response = await request(harness.server).get("/client-dist/offline-reader.client.js");

		expect(response.text).toContain("if (window.navigator.serviceWorker) {");
		expect(response.text).toContain("OfflineReader.initOfflineReader({");
	});
});
