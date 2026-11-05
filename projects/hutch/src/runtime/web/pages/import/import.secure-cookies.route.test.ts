import assert from "node:assert/strict";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { SESSION_COOKIE_NAME } from "@packages/web-session";
import request from "supertest";
import { useTestServer } from "../../../test-app";

const useApp = useTestServer();

const HTTPS_APP_ORIGIN = "https://readplace.test";

function findCookie(headers: { [key: string]: string | string[] | undefined }, prefix: string): string | undefined {
	const raw = headers["set-cookie"];
	const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
	return cookies.find((c) => c.startsWith(prefix));
}

function multipartBody(filename: string, content: Buffer): { body: Buffer; contentType: string } {
	const boundary = "----TestBoundary123456";
	const head = Buffer.from(
		`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
	);
	const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
	return {
		body: Buffer.concat([head, content, tail]),
		contentType: `multipart/form-data; boundary=${boundary}`,
	};
}

async function commitImportWithSkippedUrlsOn(appOrigin: string): Promise<request.Response> {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const harness = useApp({ ...fixture, shared: { ...fixture.shared, appOrigin } });
	const created = await harness.auth.createUser({ email: "test@example.com", password: "password123" });
	assert(created.ok, "test user must be created");
	const sessionId = await harness.auth.createSession({ userId: created.userId, emailVerified: true });
	const sessionCookie = `${SESSION_COOKIE_NAME}=${sessionId}`;
	const { body, contentType } = multipartBody(
		"urls.txt",
		Buffer.from("https://example.com/a http://localhost:3000/queue http://router.home.arpa/ https://example.com/b"),
	);
	const create = await request(harness.server)
		.post("/import?utm_source=import-acquire&utm_medium=internal&utm_content=upload-file")
		.set("Cookie", sessionCookie)
		.set("Content-Type", contentType)
		.send(body);
	const sessionPath = create.headers.location;

	return request(harness.server).post(`${sessionPath}/commit`).set("Cookie", sessionCookie);
}

function attributeNames(cookie: string): string[] {
	return cookie
		.split("; ")
		.slice(1)
		.map((attribute) => attribute.split("=")[0]);
}

describe("the import_skipped cookie follows the app origin's scheme", () => {
	it("sets the import_skipped cookie without Secure on an http origin", async () => {
		const commit = await commitImportWithSkippedUrlsOn(TEST_APP_ORIGIN);

		expect(commit.status).toBe(303);
		const skippedCookie = findCookie(commit.headers, "import_skipped=");
		assert(skippedCookie, "import_skipped cookie must be set when skips exist");
		expect(attributeNames(skippedCookie)).toEqual(["Max-Age", "Path", "Expires", "HttpOnly", "SameSite"]);
	});

	it("sets the import_skipped cookie with Secure on an https origin", async () => {
		const commit = await commitImportWithSkippedUrlsOn(HTTPS_APP_ORIGIN);

		expect(commit.status).toBe(303);
		const skippedCookie = findCookie(commit.headers, "import_skipped=");
		assert(skippedCookie, "import_skipped cookie must be set when skips exist");
		expect(attributeNames(skippedCookie)).toEqual(["Max-Age", "Path", "Expires", "HttpOnly", "Secure", "SameSite"]);
	});
});
