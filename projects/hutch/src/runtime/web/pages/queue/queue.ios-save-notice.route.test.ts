import request from "supertest";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { IOS_CLIENT_HEADER, IOS_CLIENT_VALUE } from "../../onboarding/ios-client";
import { createAccessToken } from "../../test-helpers/oauth-token";
import { useTestServer } from "../../../test-app";

const useApp = useTestServer();

const SAVE_NOTICE_BODY = "Don't close this — it's still saving.";

/** The iOS Share Extension reads a "don't close this" caption off the queue
 * collection it fetches during a save. The server offers that notice only to the
 * native app — recognised by the `X-Readplace-Client: ios` header — and never to
 * a browser, the extension, or the app's own in-app web surface (reached by the
 * spoofable `?platform=ios`, which also doesn't need it). */
describe("Queue save-in-progress notice (GET /queue, Siren)", () => {
	it("carries the notice on properties.messages for the native iOS app", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await createAccessToken(harness);

		const response = await request(harness.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.set(IOS_CLIENT_HEADER, IOS_CLIENT_VALUE);

		expect(response.status).toBe(200);
		expect(response.body.properties.messages).toEqual([
			{ type: "warning", content: { type: "text/html", body: SAVE_NOTICE_BODY } },
		]);
	});

	it("omits the notice for a Siren request without the iOS client header", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await createAccessToken(harness);

		const response = await request(harness.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`);

		expect(response.status).toBe(200);
		expect(response.body.properties.messages).toBeUndefined();
	});

	it("does not offer the notice to the spoofable in-app web surface (?platform=ios)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await createAccessToken(harness);

		const response = await request(harness.server)
			.get("/queue?platform=ios")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`);

		expect(response.status).toBe(200);
		expect(response.body.properties.messages).toBeUndefined();
	});
});
