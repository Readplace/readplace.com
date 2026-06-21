import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../../../test-app";
import { safeReturnPath } from "./changelog-dismiss.route";

const useApp = useTestServer();
const COOKIE = "rp_changelog_dismissed";

function setCookies(headers: { [key: string]: string | string[] | undefined }): string[] {
	const raw = headers["set-cookie"];
	return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

describe("safeReturnPath", () => {
	it("returns / when there is no return path", () => {
		expect(safeReturnPath(undefined)).toBe("/");
	});

	it("returns / when the return path is not a string (e.g. a duplicated form field)", () => {
		expect(safeReturnPath(["/queue", "/account"])).toBe("/");
	});

	it("returns the path and query for a root-relative return path", () => {
		expect(safeReturnPath("/queue?filter=unread")).toBe("/queue?filter=unread");
	});

	it("returns / for an absolute, cross-origin URL", () => {
		expect(safeReturnPath("https://evil.example/queue")).toBe("/");
	});

	it("returns / for a protocol-relative authority a browser would resolve off-site", () => {
		expect(safeReturnPath("//evil.example/queue")).toBe("/");
	});

	it("returns / for a path that normalises to a // authority", () => {
		expect(safeReturnPath("/..//evil.example")).toBe("/");
	});

	it("returns / for an unparseable return path", () => {
		expect(safeReturnPath("http://[")).toBe("/");
	});
});

describe("POST /banner/changelog/dismiss", () => {
	it("sets the dismissal cookie for a valid version and redirects to the posted return path", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post("/banner/changelog/dismiss")
			.type("form")
			.send({ version: "a1b2c3d4", returnTo: "/queue?filter=unread" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue?filter=unread");

		const setCookie = setCookies(response.headers);
		const cookie = setCookie.find((c) => c.startsWith(`${COOKIE}=`));
		expect(cookie).toBeDefined();
		expect(cookie).toContain(`${COOKIE}=a1b2c3d4`);
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("SameSite=Lax");
		expect(cookie).toContain("Path=/");
	});

	it("redirects to / (never a protocol-relative Location) for a // return path", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post("/banner/changelog/dismiss")
			.type("form")
			.send({ version: "a1b2c3d4", returnTo: "//evil.com" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/");
		expect(response.headers.location.startsWith("//")).toBe(false);
	});

	it("redirects to / when no return path is posted", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post("/banner/changelog/dismiss")
			.type("form")
			.send({ version: "a1b2c3d4" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/");
	});

	it("ignores an invalid version (sets no cookie) but still redirects back", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post("/banner/changelog/dismiss")
			.type("form")
			.send({ version: "not-hex-value", returnTo: "/queue" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
		const setCookie = setCookies(response.headers);
		expect(setCookie.some((c) => c.startsWith(`${COOKIE}=`))).toBe(false);
	});

	it("ignores a missing version (sets no cookie) but still redirects back", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post("/banner/changelog/dismiss")
			.type("form")
			.send({ returnTo: "/queue" });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
		const setCookie = setCookies(response.headers);
		expect(setCookie.some((c) => c.startsWith(`${COOKIE}=`))).toBe(false);
	});
});
