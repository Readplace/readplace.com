import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../../../test-app";
import { safeBackPath } from "./changelog-dismiss.route";

const useApp = useTestServer();
const COOKIE = "rp_changelog_dismissed";

function setCookies(headers: { [key: string]: string | string[] | undefined }): string[] {
	const raw = headers["set-cookie"];
	return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

describe("safeBackPath", () => {
	const ORIGIN = "https://readplace.com";

	it("returns / when there is no referer", () => {
		expect(safeBackPath(undefined, ORIGIN)).toBe("/");
	});

	it("returns the path and query for a same-origin referer", () => {
		expect(safeBackPath("https://readplace.com/queue?filter=unread", ORIGIN)).toBe(
			"/queue?filter=unread",
		);
	});

	it("returns / for a cross-origin referer", () => {
		expect(safeBackPath("https://evil.example/queue", ORIGIN)).toBe("/");
	});

	it("returns / for a protocol-relative path on a same-origin referer", () => {
		expect(safeBackPath("https://readplace.com//evil.com", ORIGIN)).toBe("/");
	});

	it("returns / for a malformed referer", () => {
		expect(safeBackPath("not a url", ORIGIN)).toBe("/");
	});
});

describe("POST /banner/changelog/dismiss", () => {
	it("sets the dismissal cookie for a valid version and redirects back to the same-origin referer", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post("/banner/changelog/dismiss")
			.type("form")
			.set("Referer", `${TEST_APP_ORIGIN}/queue`)
			.send({ version: "a1b2c3d4" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");

		const setCookie = setCookies(response.headers);
		const cookie = setCookie.find((c) => c.startsWith(`${COOKIE}=`));
		expect(cookie).toBeDefined();
		expect(cookie).toContain(`${COOKIE}=a1b2c3d4`);
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("SameSite=Lax");
		expect(cookie).toContain("Path=/");
	});

	it("redirects to / (never a protocol-relative Location) for a same-origin referer with a // path", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post("/banner/changelog/dismiss")
			.type("form")
			.set("Referer", `${TEST_APP_ORIGIN}//evil.com`)
			.send({ version: "a1b2c3d4" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/");
		expect(response.headers.location.startsWith("//")).toBe(false);
	});

	it("redirects to / when no referer is present", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post("/banner/changelog/dismiss")
			.type("form")
			.send({ version: "a1b2c3d4" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/");
	});

	it("ignores an invalid version (sets no cookie) but still redirects", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post("/banner/changelog/dismiss")
			.type("form")
			.send({ version: "not-hex-value" });

		expect(response.status).toBe(303);
		const setCookie = setCookies(response.headers);
		expect(setCookie.some((c) => c.startsWith(`${COOKIE}=`))).toBe(false);
	});

	it("ignores a missing version (sets no cookie) but still redirects", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post("/banner/changelog/dismiss")
			.type("form")
			.send({});

		expect(response.status).toBe(303);
		const setCookie = setCookies(response.headers);
		expect(setCookie.some((c) => c.startsWith(`${COOKIE}=`))).toBe(false);
	});
});
