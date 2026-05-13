import type { Effect } from "@packages/domain/article-aggregate";
import { initLambdaEffectDispatcher } from "./lambda-effect-dispatcher";

function makeDeps(overrides: {
	dispatchGenerateSummary?: jest.Mock;
	dispatchSubmitLink?: jest.Mock;
	publishEvent?: jest.Mock;
} = {}) {
	return {
		dispatchGenerateSummary:
			overrides.dispatchGenerateSummary ?? jest.fn().mockResolvedValue(undefined),
		dispatchSubmitLink:
			overrides.dispatchSubmitLink ?? jest.fn().mockResolvedValue(undefined),
		publishEvent: overrides.publishEvent ?? jest.fn().mockResolvedValue(undefined),
	};
}

describe("initLambdaEffectDispatcher", () => {
	it("forwards a generate-summary effect to dispatchGenerateSummary", async () => {
		const deps = makeDeps();

		const { dispatchEffect } = initLambdaEffectDispatcher(deps);

		await dispatchEffect({
			kind: "generate-summary",
			url: "https://example.com/article",
		});

		expect(deps.dispatchGenerateSummary).toHaveBeenCalledTimes(1);
		expect(deps.dispatchGenerateSummary).toHaveBeenCalledWith({
			url: "https://example.com/article",
		});
		expect(deps.publishEvent).not.toHaveBeenCalled();
	});

	it("forwards a dispatch-generate-summary-retry effect to dispatchGenerateSummary so the auto-heal re-prime fires", async () => {
		const deps = makeDeps();

		const { dispatchEffect } = initLambdaEffectDispatcher(deps);

		await dispatchEffect({
			kind: "dispatch-generate-summary-retry",
			url: "https://example.com/article",
			attempt: 2,
		});

		expect(deps.dispatchGenerateSummary).toHaveBeenCalledTimes(1);
		expect(deps.dispatchGenerateSummary).toHaveBeenCalledWith({
			url: "https://example.com/article",
		});
		expect(deps.publishEvent).not.toHaveBeenCalled();
	});

	it("forwards a dispatch-submit-link effect to dispatchSubmitLink with userId and rawHtml passed through", async () => {
		const deps = makeDeps();

		const { dispatchEffect } = initLambdaEffectDispatcher(deps);

		await dispatchEffect({
			kind: "dispatch-submit-link",
			url: "https://example.com/article",
			userId: "user-123",
			rawHtml: "<html></html>",
		});

		expect(deps.dispatchSubmitLink).toHaveBeenCalledTimes(1);
		expect(deps.dispatchSubmitLink).toHaveBeenCalledWith({
			url: "https://example.com/article",
			userId: "user-123",
			rawHtml: "<html></html>",
		});
		expect(deps.publishEvent).not.toHaveBeenCalled();
		expect(deps.dispatchGenerateSummary).not.toHaveBeenCalled();
	});

	it("forwards a dispatch-submit-link effect with no userId/rawHtml (anonymous /view path)", async () => {
		const deps = makeDeps();

		const { dispatchEffect } = initLambdaEffectDispatcher(deps);

		await dispatchEffect({
			kind: "dispatch-submit-link",
			url: "https://example.com/article",
		});

		expect(deps.dispatchSubmitLink).toHaveBeenCalledWith({
			url: "https://example.com/article",
			userId: undefined,
			rawHtml: undefined,
		});
	});

	it("publishes a CrawlArticleFailedEvent for a publish-crawl-article-failed effect, carrying url/reason/receiveCount in detail", async () => {
		const deps = makeDeps();

		const { dispatchEffect } = initLambdaEffectDispatcher(deps);

		await dispatchEffect({
			kind: "publish-crawl-article-failed",
			url: "https://example.com/article",
			reason: "exceeded SQS maxReceiveCount",
			receiveCount: 4,
		});

		expect(deps.publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "CrawlArticleFailed",
			detail: JSON.stringify({
				url: "https://example.com/article",
				reason: "exceeded SQS maxReceiveCount",
				receiveCount: 4,
			}),
		});
		expect(deps.dispatchGenerateSummary).not.toHaveBeenCalled();
	});

	it("publishes a RecrawlCompletedEvent for a publish-recrawl-completed effect, carrying only the url in detail", async () => {
		const deps = makeDeps();

		const { dispatchEffect } = initLambdaEffectDispatcher(deps);

		await dispatchEffect({
			kind: "publish-recrawl-completed",
			url: "https://example.com/article",
		});

		expect(deps.publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "RecrawlCompleted",
			detail: JSON.stringify({ url: "https://example.com/article" }),
		});
		expect(deps.dispatchGenerateSummary).not.toHaveBeenCalled();
	});

	it("propagates the dispatcher's rejection so the orchestrator's caller can retry", async () => {
		const deps = makeDeps({
			dispatchGenerateSummary: jest
				.fn()
				.mockRejectedValue(new Error("sqs send failed")),
		});

		const { dispatchEffect } = initLambdaEffectDispatcher(deps);

		await expect(
			dispatchEffect({
				kind: "generate-summary",
				url: "https://example.com/article",
			}),
		).rejects.toThrow("sqs send failed");
	});

	it("propagates a publish failure so SQS replays the whole transition", async () => {
		const deps = makeDeps({
			publishEvent: jest
				.fn()
				.mockRejectedValue(new Error("eventbridge throttled")),
		});

		const { dispatchEffect } = initLambdaEffectDispatcher(deps);

		await expect(
			dispatchEffect({
				kind: "publish-recrawl-completed",
				url: "https://example.com/article",
			}),
		).rejects.toThrow("eventbridge throttled");
	});

	it("publishes a CrawlArticleCompletedEvent for a publish-crawl-article-completed effect, carrying only the url in detail", async () => {
		const deps = makeDeps();

		const { dispatchEffect } = initLambdaEffectDispatcher(deps);

		await dispatchEffect({
			kind: "publish-crawl-article-completed",
			url: "https://example.com/article",
		});

		expect(deps.publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "CrawlArticleCompleted",
			detail: JSON.stringify({ url: "https://example.com/article" }),
		});
		expect(deps.dispatchGenerateSummary).not.toHaveBeenCalled();
	});

	it("publishes a LinkSavedEvent for a publish-link-saved effect, carrying url and userId in detail", async () => {
		const deps = makeDeps();

		const { dispatchEffect } = initLambdaEffectDispatcher(deps);

		await dispatchEffect({
			kind: "publish-link-saved",
			url: "https://example.com/article",
			userId: "user-123",
		});

		expect(deps.publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "LinkSaved",
			detail: JSON.stringify({
				url: "https://example.com/article",
				userId: "user-123",
			}),
		});
		expect(deps.dispatchGenerateSummary).not.toHaveBeenCalled();
	});

	it("publishes an AnonymousLinkSavedEvent for a publish-anonymous-link-saved effect, carrying only the url in detail", async () => {
		const deps = makeDeps();

		const { dispatchEffect } = initLambdaEffectDispatcher(deps);

		await dispatchEffect({
			kind: "publish-anonymous-link-saved",
			url: "https://example.com/article",
		});

		expect(deps.publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "AnonymousLinkSaved",
			detail: JSON.stringify({ url: "https://example.com/article" }),
		});
		expect(deps.dispatchGenerateSummary).not.toHaveBeenCalled();
	});

	it("publishes a SummaryGeneratedEvent for a publish-summary-generated effect, carrying url and token counts in detail", async () => {
		const deps = makeDeps();

		const { dispatchEffect } = initLambdaEffectDispatcher(deps);

		await dispatchEffect({
			kind: "publish-summary-generated",
			url: "https://example.com/article",
			inputTokens: 1234,
			outputTokens: 567,
		});

		expect(deps.publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "GlobalSummaryGenerated",
			detail: JSON.stringify({
				url: "https://example.com/article",
				inputTokens: 1234,
				outputTokens: 567,
			}),
		});
		expect(deps.dispatchGenerateSummary).not.toHaveBeenCalled();
	});

	it("publishes a SummaryGenerationFailedEvent for a publish-summary-generation-failed effect, carrying url/reason/receiveCount in detail", async () => {
		const deps = makeDeps();

		const { dispatchEffect } = initLambdaEffectDispatcher(deps);

		await dispatchEffect({
			kind: "publish-summary-generation-failed",
			url: "https://example.com/article",
			reason: "exceeded SQS maxReceiveCount",
			receiveCount: 4,
		});

		expect(deps.publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "SummaryGenerationFailed",
			detail: JSON.stringify({
				url: "https://example.com/article",
				reason: "exceeded SQS maxReceiveCount",
				receiveCount: 4,
			}),
		});
		expect(deps.dispatchGenerateSummary).not.toHaveBeenCalled();
	});

	it("throws on unknown effect kind so an unhandled variant surfaces as a Lambda failure", async () => {
		const deps = makeDeps();

		const { dispatchEffect } = initLambdaEffectDispatcher(deps);

		await expect(
			dispatchEffect({
				kind: "not-a-real-effect",
				url: "https://example.com/article",
			} as unknown as Effect),
		).rejects.toThrow(/Unhandled aggregate effect/);
	});
});
