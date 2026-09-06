import { UserIdSchema } from "@packages/domain/user";
import { buildUserCreatedEvent } from "./conversions";
import type { ClickAttribution } from "@packages/web-analytics";

const TEST_USER_ID = UserIdSchema.parse("1234567890abcdef1234567890abcdef");
const TEST_NOW = () => new Date("2026-05-13T10:00:00.000Z");

describe("buildUserCreatedEvent", () => {
	it("builds a free signup event with the lowercased-email sha256 prefix", () => {
		const event = buildUserCreatedEvent(
			{ now: TEST_NOW },
			{
				userId: TEST_USER_ID,
				email: "Alice@Example.com",
				method: "email",
				tier: "free",
				attribution: undefined,
				oauthClientId: undefined,
			},
		);

		expect(event).toEqual({
			stream: "conversions",
			event: "user_created",
			timestamp: "2026-05-13T10:00:00.000Z",
			user_id: TEST_USER_ID,
			email_hash: "ff8d9819fc0e12bf",
			method: "email",
			tier: "free",
		});
	});

	it("builds a trial signup event", () => {
		const event = buildUserCreatedEvent(
			{ now: TEST_NOW },
			{
				userId: TEST_USER_ID,
				email: "trial@example.com",
				method: "email",
				tier: "trial",
				attribution: undefined,
				oauthClientId: undefined,
			},
		);

		expect(event).toEqual({
			stream: "conversions",
			event: "user_created",
			timestamp: "2026-05-13T10:00:00.000Z",
			user_id: TEST_USER_ID,
			email_hash: "63f6f5c42a8bfcdb",
			method: "email",
			tier: "trial",
		});
	});

	it("includes visitor_id so the conversion joins to the pageview / view_opened stream for the same device", () => {
		const event = buildUserCreatedEvent(
			{ now: TEST_NOW },
			{
				userId: TEST_USER_ID,
				email: "e@example.com",
				method: "email",
				tier: "free",
				attribution: undefined,
				visitorId: "550e8400-e29b-41d4-a716-446655440000",
				oauthClientId: undefined,
			},
		);

		expect(event).toMatchObject({
			visitor_id: "550e8400-e29b-41d4-a716-446655440000",
		});
	});

	it("flattens click attribution into the event so downstream queries can group by utm_* without a join", () => {
		const attribution: ClickAttribution = {
			utm_source: "twitter",
			utm_medium: "social",
			utm_campaign: "spring",
			referrer_host: "t.co",
			first_seen_at: "2026-05-01T00:00:00.000Z",
			landing_path: "/blog/launch",
		};

		const event = buildUserCreatedEvent(
			{ now: TEST_NOW },
			{
				userId: TEST_USER_ID,
				email: "c@example.com",
				method: "email",
				tier: "free",
				attribution,
				oauthClientId: undefined,
			},
		);

		expect(event).toMatchObject({
			utm_source: "twitter",
			utm_medium: "social",
			utm_campaign: "spring",
			referrer_host: "t.co",
			first_seen_at: "2026-05-01T00:00:00.000Z",
			landing_path: "/blog/launch",
		});
	});

	it("normalizes email case before hashing so Alice@Example.com and alice@example.com produce the same hash", () => {
		const mixedCase = buildUserCreatedEvent(
			{ now: TEST_NOW },
			{
				userId: TEST_USER_ID,
				email: "Alice@Example.com",
				method: "email",
				tier: "free",
				attribution: undefined,
				oauthClientId: undefined,
			},
		);
		const lowerCase = buildUserCreatedEvent(
			{ now: TEST_NOW },
			{
				userId: TEST_USER_ID,
				email: "alice@example.com",
				method: "email",
				tier: "free",
				attribution: undefined,
				oauthClientId: undefined,
			},
		);

		expect(mixedCase.email_hash).toBe(lowerCase.email_hash);
	});

	it("omits utm_* keys entirely for an attribution-less signup, so the serialized event stays small", () => {
		const event = buildUserCreatedEvent(
			{ now: TEST_NOW },
			{
				userId: TEST_USER_ID,
				email: "d@example.com",
				method: "email",
				tier: "free",
				attribution: undefined,
				oauthClientId: undefined,
			},
		);

		expect(event).toEqual({
			stream: "conversions",
			event: "user_created",
			timestamp: "2026-05-13T10:00:00.000Z",
			user_id: TEST_USER_ID,
			email_hash: "5fe5806a804c99a3",
			method: "email",
			tier: "free",
		});
	});

	it("includes pending_save_id so a signup-blocked save can be traced to the account it created", () => {
		const event = buildUserCreatedEvent(
			{ now: TEST_NOW },
			{
				userId: TEST_USER_ID,
				email: "blocked@example.com",
				method: "email",
				tier: "free",
				attribution: undefined,
				pendingSaveId: "9f1c0c8e-3b2a-4d6e-8c1f-2a7b5d4e6f10",
				oauthClientId: undefined,
			},
		);

		expect(event).toMatchObject({
			pending_save_id: "9f1c0c8e-3b2a-4d6e-8c1f-2a7b5d4e6f10",
		});
	});

	it("includes oauth_client_id so a consent-screen conversion names the client that produced it", () => {
		const event = buildUserCreatedEvent(
			{ now: TEST_NOW },
			{
				userId: TEST_USER_ID,
				email: "connector@example.com",
				method: "email",
				tier: "free",
				attribution: undefined,
				oauthClientId: "ios-app",
			},
		);

		expect(event).toMatchObject({ oauth_client_id: "ios-app" });
	});

	it("omits pending_save_id and oauth_client_id when the signup followed neither a pending save nor a consent screen", () => {
		const event = buildUserCreatedEvent(
			{ now: TEST_NOW },
			{
				userId: TEST_USER_ID,
				email: "organic@example.com",
				method: "email",
				tier: "free",
				attribution: undefined,
				oauthClientId: undefined,
			},
		);

		expect(event).toEqual({
			stream: "conversions",
			event: "user_created",
			timestamp: "2026-05-13T10:00:00.000Z",
			user_id: TEST_USER_ID,
			email_hash: "908cf3c1dc654595",
			method: "email",
			tier: "free",
		});
	});
});
