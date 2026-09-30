import { UserIdSchema } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import { initEmitQueueDigestEvent, type QueueDigestLogEvent } from "./queue-digest-events";

function createCapturingLogger(): {
	logger: HutchLogger.Typed<QueueDigestLogEvent>;
	captured: QueueDigestLogEvent[];
} {
	const captured: QueueDigestLogEvent[] = [];
	const logger: HutchLogger.Typed<QueueDigestLogEvent> = {
		info: (data) => { captured.push(data); },
		error: () => {},
		warn: () => {},
		debug: () => {},
	};
	return { logger, captured };
}

const NOW = () => new Date("2026-06-10T12:00:00.000Z");
const USER_ID = UserIdSchema.parse("user-1");

describe("initEmitQueueDigestEvent", () => {
	it("emits queue_digest_sent on the analytics stream with the send id the email links carry as utm_term", () => {
		const { logger, captured } = createCapturingLogger();
		const emit = initEmitQueueDigestEvent({ logger, now: NOW });

		emit.sent({
			userId: USER_ID,
			sendId: "msg-1",
			kind: "regular",
			itemCount: 3,
			previouslyEmailedCount: 0,
			tier: "paid",
			trialDay: null,
		});

		expect(captured).toEqual([{
			stream: "analytics",
			event: "queue_digest_sent",
			timestamp: "2026-06-10T12:00:00.000Z",
			user_id: USER_ID,
			send_id: "msg-1",
			kind: "regular",
			item_count: 3,
			previously_emailed_count: 0,
			tier: "paid",
			trial_day: null,
		}]);
	});

	it("adds the hours left in the trial to a pay digest's queue_digest_sent", () => {
		const { logger, captured } = createCapturingLogger();
		const emit = initEmitQueueDigestEvent({ logger, now: NOW });

		emit.sent({
			userId: USER_ID,
			sendId: "msg-2",
			kind: "pay",
			hoursToTrialEnd: 80,
			itemCount: 4,
			previouslyEmailedCount: 2,
			tier: "trial",
			trialDay: 11,
		});

		expect(captured).toEqual([{
			stream: "analytics",
			event: "queue_digest_sent",
			timestamp: "2026-06-10T12:00:00.000Z",
			user_id: USER_ID,
			send_id: "msg-2",
			kind: "pay",
			hours_to_trial_end: 80,
			item_count: 4,
			previously_emailed_count: 2,
			tier: "trial",
			trial_day: 11,
		}]);
	});

	it("emits queue_digest_skipped with the reader's tier and the reason", () => {
		const { logger, captured } = createCapturingLogger();
		const emit = initEmitQueueDigestEvent({ logger, now: NOW });

		emit.skipped({ userId: USER_ID, tier: "trial", reason: "no-eligible-items" });

		expect(captured).toEqual([{
			stream: "analytics",
			event: "queue_digest_skipped",
			timestamp: "2026-06-10T12:00:00.000Z",
			user_id: USER_ID,
			tier: "trial",
			reason: "no-eligible-items",
		}]);
	});
});
