import assert from "node:assert/strict";
import request from "supertest";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import {
	IOS_CLIENT_HEADER,
	IOS_CLIENT_VALUE,
	SAVE_CONTINUITY_HEADER,
} from "../../onboarding/ios-client";
import { SIREN_DISCOVERY_MAX_AGE_SECONDS } from "../../siren-discovery-cache";
import { createAccessToken } from "../../test-helpers/oauth-token";
import { useTestServer, loginAgent } from "../../../test-app";

const useApp = useTestServer();

function varyFields(header: string | undefined): string[] {
	assert(header, "Vary header must be set on the Siren collection");
	return header.split(",").map((field) => field.trim().toLowerCase());
}

describe("Siren discovery caching (GET /queue)", () => {
	it("lets the iOS app hold the collection for the server-defined lifetime, keyed on every header that shapes it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await createAccessToken(harness);

		const response = await request(harness.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.set(IOS_CLIENT_HEADER, IOS_CLIENT_VALUE);

		expect(response.status).toBe(200);
		expect(response.headers["cache-control"]).toBe(
			`private, max-age=${SIREN_DISCOVERY_MAX_AGE_SECONDS}`,
		);
		expect(varyFields(response.headers.vary)).toEqual([
			"accept",
			"origin",
			"authorization",
			IOS_CLIENT_HEADER,
			SAVE_CONTINUITY_HEADER,
		]);
		const etag = response.headers.etag;
		assert(etag, "the collection must carry an ETag so a stale copy can revalidate");
		expect(etag.startsWith('W/"')).toBe(true);
	});

	it("makes every other Siren client revalidate, so only the app trades freshness for the one-round-trip save", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await createAccessToken(harness);

		const response = await request(harness.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`);

		expect(response.status).toBe(200);
		expect(response.headers["cache-control"]).toBe("private, no-cache");
		expect(varyFields(response.headers.vary)).toEqual([
			"accept",
			"origin",
			"authorization",
			IOS_CLIENT_HEADER,
			SAVE_CONTINUITY_HEADER,
		]);
	});

	it("answers a revalidation of an unchanged collection with 304 and no body", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await createAccessToken(harness);
		const readCollection = () =>
			request(harness.server)
				.get("/queue")
				.set("Accept", SIREN_MEDIA_TYPE)
				.set("Authorization", `Bearer ${token}`)
				.set(IOS_CLIENT_HEADER, IOS_CLIENT_VALUE);

		const first = await readCollection();
		const etag = first.headers.etag;
		assert(etag, "first read must carry an ETag");

		const revalidated = await readCollection().set("If-None-Match", etag);

		expect(revalidated.status).toBe(304);
		expect(revalidated.text).toBe("");
		expect(revalidated.headers.etag).toBe(etag);
	});

	it("re-ships the collection when a save happened since the cached copy was taken", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await createAccessToken(harness);
		const readCollection = () =>
			request(harness.server)
				.get("/queue")
				.set("Accept", SIREN_MEDIA_TYPE)
				.set("Authorization", `Bearer ${token}`)
				.set(IOS_CLIENT_HEADER, IOS_CLIENT_VALUE);

		const before = await readCollection();
		const staleEtag = before.headers.etag;
		assert(staleEtag, "first read must carry an ETag");

		const saved = await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/siren-caching-save" });
		expect(saved.status).toBe(201);

		const after = await readCollection().set("If-None-Match", staleEtag);

		expect(after.status).toBe(200);
		expect(after.body.entities).toHaveLength(1);
		expect(after.body.entities[0].properties.url).toBe(
			"https://example.com/siren-caching-save",
		);
	});

	it("leaves the browser listing uncached, since only the Siren representation is held", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue");

		expect(response.status).toBe(200);
		expect(response.headers["cache-control"]).toBeUndefined();
	});
});
