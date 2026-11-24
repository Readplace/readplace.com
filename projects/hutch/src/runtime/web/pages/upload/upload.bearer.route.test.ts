import assert from "node:assert/strict";
import request from "supertest";
import { UploadIdSchema } from "@packages/media-contracts";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { type TestAppHarness, loginAgent, useTestServer } from "../../../test-app";
import { saveAccessTokenForUser } from "../../test-helpers/oauth-token";

const useApp = useTestServer();
const SIREN = "application/vnd.siren+json";
const ONE_DAY_MS = 86_400_000;

interface SirenActionBody {
	name: string;
	href: string;
	method: string;
	title?: string;
	type?: string;
	fields?: { name: string; type: string; value?: string }[];
}

interface SirenLinkBody {
	rel: string[];
	href: string;
	title?: string;
}

function actionNamed(body: { actions?: SirenActionBody[] }, name: string): SirenActionBody {
	const action = body.actions?.find((a) => a.name === name);
	assert(action, `the entity must carry a ${name} action`);
	return action;
}

function linkNamed(body: { links?: SirenLinkBody[] }, rel: string): SirenLinkBody {
	const link = body.links?.find((l) => l.rel.includes(rel));
	assert(link, `the entity must carry a ${rel} link`);
	return link;
}

function epubPrefix(): Uint8Array {
	const bytes = Buffer.alloc(64);
	Buffer.from([0x50, 0x4b, 0x03, 0x04]).copy(bytes, 0);
	Buffer.from("mimetypeapplication/epub+zip").copy(bytes, 30);
	return bytes;
}

async function bearerFor(harness: TestAppHarness, email: string) {
	await harness.auth.createUser({ email, password: "password123" });
	const userId = (await harness.auth.findUserByEmail(email))?.userId;
	assert(userId, `${email} must exist`);
	return { token: await saveAccessTokenForUser(harness, userId), userId };
}

function sirenAs(harness: TestAppHarness, token: string) {
	return {
		get: (path: string) => request(harness.server).get(path).set("Accept", SIREN).set("Authorization", `Bearer ${token}`),
		post: (path: string) => request(harness.server).post(path).set("Accept", SIREN).set("Authorization", `Bearer ${token}`),
	};
}

function uploadIdOf(confirmHref: string) {
	return UploadIdSchema.parse(confirmHref.split("/")[2]);
}

describe("Upload routes for a bearer client", () => {
	it("stages a Siren upload owned by the bearer's account", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { token, userId } = await bearerFor(harness, "reader@example.com");

		const staged = await sirenAs(harness, token).post("/upload").type("form").send({ fileName: "dune.epub", byteLength: "1024" });

		expect(staged.status).toBe(200);
		const uploadId = uploadIdOf(actionNamed(staged.body, "confirm-received").href);
		const session = await harness.mediaUpload.findMediaUploadSession({ uploadId, userId });
		expect(session?.userId).toBe(userId);
	});

	it("refuses an invalid bearer with 401 instead of staging a guest upload", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await sirenAs(harness, "not-a-real-token").post("/upload").type("form").send({});

		expect(response.status).toBe(401);
		expect(response.headers["www-authenticate"]).toContain('error="invalid_token"');
		expect(response.body.properties.code).toBe("invalid-token");
	});

	it("describes the upload entry in Siren: a bearer viewer is offered video up to 2 GiB", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { token } = await bearerFor(harness, "reader@example.com");

		const response = await sirenAs(harness, token).get("/upload");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toContain(SIREN);
		expect(response.body.class).toEqual(["upload"]);
		expect(linkNamed(response.body, "self").href).toBe("/upload");
		expect(response.body.properties.kinds.map((kind: { name: string }) => kind.name)).toEqual(["book", "audio", "video"]);
		expect(response.body.properties.kinds[2]).toEqual({
			name: "video",
			description: "Video: MP4, up to 2 GB.",
			accepts: { "video/mp4": [".mp4"] },
			uploadCeilingBytes: 2 * 1024 ** 3,
			ceilingLabel: "2 GB",
		});
		expect(response.body.properties.heading).toBe("Upload a book, an audio file, or a video");
		expect(response.body.properties.transcriptAllowance).toBe(
			"Audio and video files get a timestamped transcript, up to 20 minutes a day.",
		);
		expect(actionNamed(response.body, "stage-upload")).toEqual({
			name: "stage-upload",
			href: "/upload",
			method: "POST",
			type: "application/x-www-form-urlencoded",
			fields: [
				{ name: "fileName", type: "text" },
				{ name: "byteLength", type: "number" },
			],
		});
	});

	it("describes the guest kinds to a Siren viewer with no bearer", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/upload").set("Accept", SIREN);

		expect(response.status).toBe(200);
		expect(response.body.properties.kinds.map((kind: { name: string }) => kind.name)).toEqual(["book", "audio"]);
	});

	it("links a staged upload to its own status so a client resumes by following it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { token } = await bearerFor(harness, "reader@example.com");
		const client = sirenAs(harness, token);

		const staged = await client.post("/upload").type("form").send({});
		const uploadId = uploadIdOf(actionNamed(staged.body, "confirm-received").href);
		expect(linkNamed(staged.body, "self").href).toBe(`/upload/${uploadId}`);

		const status = await client.get(linkNamed(staged.body, "self").href);
		expect(status.status).toBe(200);
		expect(status.body.class).toEqual(["upload-staged"]);
		expect(linkNamed(status.body, "self").href).toBe(`/upload/${uploadId}`);
	});

	it("commits a confirmed bearer upload straight to the owner's reading list", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { token, userId } = await bearerFor(harness, "reader@example.com");
		const client = sirenAs(harness, token);

		const staged = await client.post("/upload").type("form").send({ fileName: "dune.epub" });
		const confirm = actionNamed(staged.body, "confirm-received").href;
		harness.mediaUpload.receivePendingOriginal({ uploadId: uploadIdOf(confirm), bytes: epubPrefix() });

		const received = await client.post(confirm);
		expect(received.status).toBe(303);
		expect(received.headers.location).toBe("/queue");
		expect(harness.mediaUpload.publishedMediaUploadCommitted.map((event) => event.userId)).toEqual([userId]);
	});

	it("hides one account's upload from another account's bearer", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const owner = await bearerFor(harness, "owner@example.com");
		const other = await bearerFor(harness, "other@example.com");

		const staged = await sirenAs(harness, owner.token).post("/upload").type("form").send({});
		const confirm = actionNamed(staged.body, "confirm-received").href;
		harness.mediaUpload.receivePendingOriginal({ uploadId: uploadIdOf(confirm), bytes: epubPrefix() });

		const status = await sirenAs(harness, other.token).get(`/upload/${uploadIdOf(confirm)}`);
		expect(status.status).toBe(404);
		expect(status.body.properties.code).toBe("upload_session_not_found");

		const received = await sirenAs(harness, other.token).post(confirm);
		expect(received.status).toBe(404);
		expect(received.body.properties.code).toBe("upload_session_not_found");
	});

	it("refuses a locked account's bearer at stage and at confirm", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.shared.now = () => new Date(Date.now() + 8 * ONE_DAY_MS);
		const harness = useApp(fixture);
		const { token } = await bearerFor(harness, "reader@example.com");
		const client = sirenAs(harness, token);

		const stage = await client.post("/upload").type("form").send({});
		expect(stage.status).toBe(403);

		const confirm = await client.post("/upload/0123456789abcdef0123456789abcdef/received");
		expect(confirm.status).toBe(403);
	});

	it("judges a locked bearer by its own account when the request also carries another account's cookie", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const cookieAgent = await loginAgent(harness.server, harness.auth);
		const locked = await bearerFor(harness, "locked@example.com");
		await harness.auth.backdateRegistration({
			userId: locked.userId,
			registeredAt: new Date(Date.now() - 8 * ONE_DAY_MS).toISOString(),
		});

		const stage = await cookieAgent
			.post("/upload")
			.set("Accept", SIREN)
			.set("Authorization", `Bearer ${locked.token}`)
			.type("form")
			.send({});

		expect(stage.status).toBe(403);
	});

	it("advertises the upload entry on the collection as an untitled link", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { token } = await bearerFor(harness, "reader@example.com");

		const collection = await sirenAs(harness, token).get("/queue");

		expect(collection.status).toBe(200);
		expect(linkNamed(collection.body, "upload")).toEqual({ rel: ["upload"], href: "/upload" });
	});
});
