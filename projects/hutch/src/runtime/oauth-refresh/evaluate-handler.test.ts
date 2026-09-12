import { initRefreshEvaluationHandler } from "./evaluate-handler";
import type { SQSEvent, Context } from "aws-lambda";

it("uses the scheduled minute when SQS delivers or retries late", async () => {
	const evaluate = jest.fn().mockResolvedValue({});
	const event: Partial<SQSEvent> = { Records: [{ body: JSON.stringify({ scheduledAt: "2026-09-11T12:00:00Z" }) } as SQSEvent["Records"][number]] };
	await initRefreshEvaluationHandler({ evaluate })(event as SQSEvent, {} as Context, jest.fn());
	expect(evaluate.mock.calls).toEqual([[Date.parse("2026-09-11T12:00:00Z")]]);
});

it("propagates evaluation failure to SQS redelivery", async () => {
	const evaluate = jest.fn().mockRejectedValue(new Error("query failed"));
	const event: Partial<SQSEvent> = { Records: [{ body: JSON.stringify({ scheduledAt: "2026-09-11T12:00:00Z" }) } as SQSEvent["Records"][number]] };
	await expect(initRefreshEvaluationHandler({ evaluate })(event as SQSEvent, {} as Context, jest.fn())).rejects.toThrow("query failed");
});
