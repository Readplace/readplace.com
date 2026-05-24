export function buildSqsEvent(records: Array<{ messageId: string; body: string }>) {
	return {
		Records: records.map((r) => ({
			messageId: r.messageId,
			receiptHandle: "handle",
			body: r.body,
			attributes: {
				ApproximateReceiveCount: "1",
				SentTimestamp: "0",
				SenderId: "sender",
				ApproximateFirstReceiveTimestamp: "0",
			},
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:us-east-1:123456789:test-queue",
			awsRegion: "us-east-1",
		})),
	};
}
