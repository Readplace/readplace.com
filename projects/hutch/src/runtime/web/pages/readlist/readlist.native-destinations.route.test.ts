import assert from "node:assert/strict";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import request from "supertest";
import { z } from "zod";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { NATIVE_CLIENT_HEADER } from "../../onboarding/native-client";
import { saveAccessTokenForClient } from "../../test-helpers/oauth-token";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

type TestHarness = ReturnType<typeof useApp>;

const DestinationSchema = z.object({ label: z.string(), href: z.string() });
const ReadlistEntrySchema = z.object({
	label: z.string(),
	rel: z.enum(["current", "readlist"]),
	href: z.string(),
	preferences: DestinationSchema.optional(),
	integrations: DestinationSchema.optional(),
});
const CollectionSchema = z.object({ properties: z.object({ readlists: z.array(ReadlistEntrySchema) }) });

async function signedInReader(harness: TestHarness) {
	const agent = await loginAgent(harness.server, harness.auth);
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "the signed-in reader must exist");
	const token = await saveAccessTokenForClient(harness, { userId: user.userId, clientId: "ios-app" });
	return { agent, token };
}

async function nativeReadlists(harness: TestHarness, input: { token: string; path: string; platform: "ios" | "android" }) {
	const response = await request(harness.server)
		.get(input.path)
		.set("Accept", SIREN_MEDIA_TYPE)
		.set("Authorization", `Bearer ${input.token}`)
		.set(NATIVE_CLIENT_HEADER, input.platform);
	expect(response.status).toBe(200);
	return CollectionSchema.parse(response.body).properties.readlists;
}

describe("Readlist settings destinations for the native apps (GET /queue, Siren)", () => {
	it("advertises Preferences on a named current readlist, and the href opens that readlist's Preferences", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, token } = await signedInReader(harness);
		const created = await agent.post("/queue/queues").type("form").send({ label: "Work" });
		const slug = new URL(created.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
		assert(slug, "creating a readlist must land the reader on it");

		const readlists = await nativeReadlists(harness, { token, path: `/queue?readlist=${slug}`, platform: "ios" });

		const current = readlists.find((entry) => entry.rel === "current");
		expect(current?.preferences).toEqual({ label: "Preferences", href: `/queue/queues/${slug}/preferences?platform=ios` });
		expect(readlists.filter((entry) => entry.preferences || entry.integrations)).toHaveLength(1);
		assert(current?.preferences);
		const page = await agent.get(current.preferences.href);
		expect(page.status).toBe(200);
		expect(page.text).toContain("data-test-readlist-preferences");
	});

	it("advertises Integrations on the \"All\" readlist, and the href opens the signed-in integrations index", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, token } = await signedInReader(harness);

		const readlists = await nativeReadlists(harness, { token, path: "/queue", platform: "android" });

		expect(readlists).toEqual([
			{
				label: expect.any(String),
				rel: "current",
				href: "/queue",
				integrations: { label: "Connectors", href: "/newsletters?platform=android" },
			},
		]);
		const page = await agent.get("/newsletters?platform=android");
		expect(page.status).toBe(200);
		expect(page.text).toContain('data-test-integration="gmail"');
	});

	it("sends a signed-out browser that follows an advertised href to sign in", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { token } = await signedInReader(harness);
		const [current] = await nativeReadlists(harness, { token, path: "/queue", platform: "ios" });
		assert(current?.integrations);

		const response = await request(harness.server).get(current.integrations.href);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`/login?return=${encodeURIComponent(current.integrations.href)}`);
	});

	it("advertises no destination to a Siren client that is not a Readplace app", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { token } = await signedInReader(harness);

		const response = await request(harness.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`);

		expect(CollectionSchema.parse(response.body).properties.readlists).toEqual([
			{ label: expect.any(String), rel: "current", href: "/queue" },
		]);
	});
});
