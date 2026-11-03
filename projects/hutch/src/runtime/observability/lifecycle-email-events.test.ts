import { UserIdSchema } from "@packages/domain/user";
import { LIFECYCLE_EMAIL_EVENTS, STREAMS } from "./events";
import { LIFECYCLE_EMAIL_KINDS, initEmitLifecycleEmailSent, type LifecycleEmailSentEvent } from "./lifecycle-email-events";

const userId = UserIdSchema.parse("reader");
const NOW = new Date("2026-06-04T10:00:00.000Z");

function buildSubject() {
	const events: LifecycleEmailSentEvent[] = [];
	const capture = (event: LifecycleEmailSentEvent) => { events.push(event); };
	const emit = initEmitLifecycleEmailSent({
		logger: { info: capture, error: capture, warn: capture, debug: capture },
		now: () => NOW,
	});
	return { emit, events };
}

describe("initEmitLifecycleEmailSent", () => {
	it("writes every field of a send", () => {
		const { emit, events } = buildSubject();

		emit({ userId, kind: "trial-reminder", trialDay: 12, utmSource: "trial-reminder", delivery: "automated" });

		expect(events).toEqual([
			{
				stream: STREAMS.analytics,
				event: LIFECYCLE_EMAIL_EVENTS.sent,
				timestamp: NOW.toISOString(),
				user_id: userId,
				kind: "trial-reminder",
				trial_day: 12,
				utm_source: "trial-reminder",
				delivery: "automated",
			},
		]);
	});

	it("writes a missing trial day and utm source as null rather than omitting them", () => {
		const { emit, events } = buildSubject();

		emit({ userId, kind: "trial-feedback", trialDay: null, utmSource: null, delivery: "founder-manual" });

		expect(Object.keys(events[0])).toEqual(expect.arrayContaining(["trial_day", "utm_source"]));
		expect(events[0].trial_day).toBeNull();
		expect(events[0].utm_source).toBeNull();
		expect(events[0].delivery).toBe("founder-manual");
	});

	it.each(LIFECYCLE_EMAIL_KINDS)("records the kind %s as given", (kind) => {
		const { emit, events } = buildSubject();

		emit({ userId, kind, trialDay: null, utmSource: null, delivery: "automated" });

		expect(events[0].kind).toBe(kind);
	});
});
