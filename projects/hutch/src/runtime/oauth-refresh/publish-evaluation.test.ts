import { noopLogger } from "@packages/hutch-logger";
import { OAuthRefreshEvaluatedEvent } from "@packages/hutch-infra-components";
import { initPublishRefreshEvaluation } from "./publish-evaluation";

it("publishes the completed evaluation fact and diagnostic counts after metrics", async () => {
	const publish = jest.fn().mockResolvedValue(undefined);
	const publishEvent = jest.fn().mockResolvedValue(undefined);
	const info = jest.fn();
	const input = { minute: 1800000000000, counts: { unexpected: 5, raw: 10, test: 1, expected: 2, recovered: 2, unknown: 0, pending: 0 } };
	await initPublishRefreshEvaluation({ publish, publishEvent, logger: { ...noopLogger, info } })(input);
	expect(publishEvent).toHaveBeenCalledWith(OAuthRefreshEvaluatedEvent, input);
	expect(JSON.parse(info.mock.calls[0][0])).toEqual({ event: "oauth_refresh_evaluated", minute: input.minute, ...input.counts });
});
