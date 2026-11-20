import request from "supertest";
import { useTestServer } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();

describe("GET /terms", () => {
	it("should return 200 and HTML content", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/terms");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it("returns markdown when Accept: text/markdown is sent", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server)
			.get("/terms")
			.set("Accept", "text/markdown");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(response.text).toMatch(/^# /);
	});

	it("discloses subscriptions, AI-assistant payments, and consumer rights", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/terms");

		expect(response.text).toContain("Last updated: 20 November 2026");
		for (const heading of [
			"Subscriptions, billing and renewals",
			"Using Readplace with AI assistants",
			"Refunds and your consumer rights",
		]) {
			expect(response.text).toContain(heading);
		}
	});

	it("states the minimum age", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/terms");

		expect(response.text).toContain("You must be at least 13 years old to use Readplace.");
	});

	it("moves a lapsed account to the free plan within daily limits it does not number, and with its paid-only features", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/terms");

		expect(response.text).toContain("If your trial ends or your subscription lapses, your account moves to the free plan.");
		expect(response.text).toContain("you can keep saving, highlighting, importing and uploading within daily limits.");
		expect(response.text).not.toMatch(/\d+ new saves/);
		expect(response.text).not.toContain("continued access requires a paid subscription");
		expect(response.text).toContain("After the trial, the paid features and saving without daily limits require a paid subscription");
		expect(response.text).toContain(
			"The Inbox (custom emails and newsletter triage), Next read, Past reads, readlist purpose filtering and Gmail are available only with a paid subscription.",
		);
	});

	it("says uploaded and captured pages may be removed, and where to report one", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/terms");

		expect(response.text).toContain("any page you upload or capture");
		expect(response.text).toContain('href="mailto:readplace+report@readplace.com"');
	});
});
