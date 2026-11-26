import { noopLogger } from "@packages/logger";
import { initPublishRefreshEvaluation } from "./publish-evaluation";

it("publishes the metrics and logs the diagnostic counts", async () => {
	const publish = jest.fn().mockResolvedValue(undefined);
	const info = jest.fn();
	const input = { minute: 1800000000000, counts: { unexpected: 5, raw: 10, challenged: 0, expected: 2, recovered: 2, unknown: 0, pending: 0 } };
	await initPublishRefreshEvaluation({ publish, logger: { ...noopLogger, info } })(input);
	expect(publish).toHaveBeenCalledWith(input);
	expect(JSON.parse(info.mock.calls[0][0])).toEqual({ event: "oauth_refresh_evaluated", minute: input.minute, ...input.counts });
});
