import { initLambdaEffectDispatcher } from "./lambda-effect-dispatcher";

describe("initLambdaEffectDispatcher", () => {
	it("forwards a generate-summary effect to dispatchGenerateSummary", async () => {
		const dispatchGenerateSummary = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const { dispatchEffect } = initLambdaEffectDispatcher({
			dispatchGenerateSummary,
			publishEvent,
		});

		await dispatchEffect({
			kind: "generate-summary",
			url: "https://example.com/article",
		});

		expect(dispatchGenerateSummary).toHaveBeenCalledTimes(1);
		expect(dispatchGenerateSummary).toHaveBeenCalledWith({
			url: "https://example.com/article",
		});
		expect(publishEvent).not.toHaveBeenCalled();
	});

	it("publishes a CrawlArticleFailedEvent for a publish-crawl-article-failed effect, carrying url/reason/receiveCount in detail", async () => {
		const dispatchGenerateSummary = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const { dispatchEffect } = initLambdaEffectDispatcher({
			dispatchGenerateSummary,
			publishEvent,
		});

		await dispatchEffect({
			kind: "publish-crawl-article-failed",
			url: "https://example.com/article",
			reason: "exceeded SQS maxReceiveCount",
			receiveCount: 4,
		});

		expect(publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "CrawlArticleFailed",
			detail: JSON.stringify({
				url: "https://example.com/article",
				reason: "exceeded SQS maxReceiveCount",
				receiveCount: 4,
			}),
		});
		expect(dispatchGenerateSummary).not.toHaveBeenCalled();
	});

	it("publishes a RecrawlCompletedEvent for a publish-recrawl-completed effect, carrying only the url in detail", async () => {
		const dispatchGenerateSummary = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const { dispatchEffect } = initLambdaEffectDispatcher({
			dispatchGenerateSummary,
			publishEvent,
		});

		await dispatchEffect({
			kind: "publish-recrawl-completed",
			url: "https://example.com/article",
		});

		expect(publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "RecrawlCompleted",
			detail: JSON.stringify({ url: "https://example.com/article" }),
		});
		expect(dispatchGenerateSummary).not.toHaveBeenCalled();
	});

	it("propagates the dispatcher's rejection so the orchestrator's caller can retry", async () => {
		const dispatchGenerateSummary = jest
			.fn()
			.mockRejectedValue(new Error("sqs send failed"));
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const { dispatchEffect } = initLambdaEffectDispatcher({
			dispatchGenerateSummary,
			publishEvent,
		});

		await expect(
			dispatchEffect({
				kind: "generate-summary",
				url: "https://example.com/article",
			}),
		).rejects.toThrow("sqs send failed");
	});

	it("propagates a publish failure so SQS replays the whole transition", async () => {
		const dispatchGenerateSummary = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest
			.fn()
			.mockRejectedValue(new Error("eventbridge throttled"));

		const { dispatchEffect } = initLambdaEffectDispatcher({
			dispatchGenerateSummary,
			publishEvent,
		});

		await expect(
			dispatchEffect({
				kind: "publish-recrawl-completed",
				url: "https://example.com/article",
			}),
		).rejects.toThrow("eventbridge throttled");
	});
});
