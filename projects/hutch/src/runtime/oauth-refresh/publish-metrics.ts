import { PutMetricDataCommand, type CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import type { RefreshCounts } from "./outcomes";

export function initPublishRefreshMetrics(client: Pick<CloudWatchClient, "send">) {
	return async (input: { minute: number; counts: RefreshCounts }) => {
		await client.send(new PutMetricDataCommand({ Namespace: "Readplace/OAuth", MetricData: [
			{ MetricName: "OAuthRefreshUnexpected24h", Value: input.counts.unexpected, Unit: "Count", Timestamp: new Date(input.minute) },
			{ MetricName: "OAuthRefreshEvaluationSucceeded", Value: 1, Unit: "Count", Timestamp: new Date(input.minute) },
		] }));
	};
}
