import { initPublishRefreshMetrics } from "./publish-metrics";

it("publishes the rolling count and heartbeat at the evaluation minute", async () => {
	const send = jest.fn().mockResolvedValue({});
	await initPublishRefreshMetrics({ send })({ minute: 1800000000000, counts: { unexpected: 5, raw: 5, test: 0, expected: 0, recovered: 0, unknown: 5, pending: 0 } });
	expect(send.mock.calls[0][0].input).toEqual({ Namespace: "Readplace/OAuth", MetricData: [
		{ MetricName: "OAuthRefreshUnexpected24h", Value: 5, Unit: "Count", Timestamp: new Date(1800000000000) },
		{ MetricName: "OAuthRefreshEvaluationSucceeded", Value: 1, Unit: "Count", Timestamp: new Date(1800000000000) },
	] });
});
