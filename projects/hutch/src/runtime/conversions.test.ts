import type { HutchLogger } from "@packages/hutch-logger";
import { UserIdSchema } from "@packages/domain/user";
import { type ConversionEvent, emitUserCreated } from "./conversions";
import type { ClickAttribution } from "./web/click-attribution.middleware";

function createCapturingLogger(): {
	logger: HutchLogger.Typed<ConversionEvent>;
	captured: ConversionEvent[];
} {
	const captured: ConversionEvent[] = [];
	const logger: HutchLogger.Typed<ConversionEvent> = {
		info: (data) => {
			captured.push(data);
		},
		error: () => {},
		warn: () => {},
		debug: () => {},
	};
	return { logger, captured };
}

const TEST_USER_ID = UserIdSchema.parse("1234567890abcdef1234567890abcdef");
const TEST_NOW = () => new Date("2026-05-13T10:00:00.000Z");

describe("emitUserCreated", () => {
	it("emits a free signup event with the lowercased-email sha256 prefix and no stripe id", () => {
		const { logger, captured } = createCapturingLogger();

		emitUserCreated(
			{ logger, now: TEST_NOW },
			{
				userId: TEST_USER_ID,
				email: "Alice@Example.com",
				method: "email",
				tier: "free",
				attribution: undefined,
			},
		);

		expect(captured).toHaveLength(1);
		expect(captured[0]).toEqual({
			stream: "conversions",
			event: "user_created",
			timestamp: "2026-05-13T10:00:00.000Z",
			user_id: TEST_USER_ID,
			email_hash: "ff8d9819fc0e12bf",
			method: "email",
			tier: "free",
		});
		expect(JSON.stringify(captured[0])).not.toContain("stripe_checkout_session_id");
	});

	it("includes stripe_checkout_session_id for paid signups so the event can be joined to Stripe payment data downstream", () => {
		const { logger, captured } = createCapturingLogger();

		emitUserCreated(
			{ logger, now: TEST_NOW },
			{
				userId: TEST_USER_ID,
				email: "bob@example.com",
				method: "google",
				tier: "paid",
				stripeCheckoutSessionId: "cs_test_123",
				attribution: undefined,
			},
		);

		expect(captured[0]).toMatchObject({
			tier: "paid",
			stripe_checkout_session_id: "cs_test_123",
			method: "google",
		});
	});

	it("flattens click attribution into the event so downstream queries can group by utm_* without a join", () => {
		const { logger, captured } = createCapturingLogger();
		const attribution: ClickAttribution = {
			utm_source: "twitter",
			utm_medium: "social",
			utm_campaign: "spring",
			referrer_host: "t.co",
			first_seen_at: "2026-05-01T00:00:00.000Z",
			landing_path: "/blog/launch",
		};

		emitUserCreated(
			{ logger, now: TEST_NOW },
			{
				userId: TEST_USER_ID,
				email: "c@example.com",
				method: "email",
				tier: "free",
				attribution,
			},
		);

		expect(captured[0]).toMatchObject({
			utm_source: "twitter",
			utm_medium: "social",
			utm_campaign: "spring",
			referrer_host: "t.co",
			first_seen_at: "2026-05-01T00:00:00.000Z",
			landing_path: "/blog/launch",
		});
	});

	it("normalizes email case before hashing so Alice@Example.com and alice@example.com produce the same hash", () => {
		const { logger, captured } = createCapturingLogger();

		emitUserCreated(
			{ logger, now: TEST_NOW },
			{
				userId: TEST_USER_ID,
				email: "Alice@Example.com",
				method: "email",
				tier: "free",
				attribution: undefined,
			},
		);
		emitUserCreated(
			{ logger, now: TEST_NOW },
			{
				userId: TEST_USER_ID,
				email: "alice@example.com",
				method: "email",
				tier: "free",
				attribution: undefined,
			},
		);

		expect(captured[0].email_hash).toBe(captured[1].email_hash);
	});

	it("emits attribution-less signups without leaking utm_* keys into the JSON (saves bytes per event)", () => {
		const { logger, captured } = createCapturingLogger();

		emitUserCreated(
			{ logger, now: TEST_NOW },
			{
				userId: TEST_USER_ID,
				email: "d@example.com",
				method: "email",
				tier: "free",
				attribution: undefined,
			},
		);

		const serialized = JSON.stringify(captured[0]);
		expect(serialized).not.toContain("utm_source");
		expect(serialized).not.toContain("utm_medium");
		expect(serialized).not.toContain("utm_campaign");
		expect(serialized).not.toContain("utm_content");
		expect(serialized).not.toContain("referrer_host");
		expect(serialized).not.toContain("first_seen_at");
		expect(serialized).not.toContain("landing_path");
	});
});
