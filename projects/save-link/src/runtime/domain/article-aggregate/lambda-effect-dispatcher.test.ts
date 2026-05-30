import type { Effect } from "@packages/domain/article-aggregate";
import {
	AnonymousLinkSavedEvent,
	CanonicalContentChangedEvent,
	CrawlArticleCompletedEvent,
	CrawlArticleFailedEvent,
	LinkSavedEvent,
	ReaderViewLoadingSucceeded,
	RecrawlCompletedEvent,
	SubmitLinkCommand,
	SummaryGeneratedEvent,
	SummaryGenerationFailedEvent,
} from "@packages/hutch-infra-components";
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

	it("forwards a dispatch-generate-summary-retry effect to dispatchGenerateSummary so the auto-heal re-prime fires", async () => {
		const dispatchGenerateSummary = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const { dispatchEffect } = initLambdaEffectDispatcher({
			dispatchGenerateSummary,
			publishEvent,
		});

		await dispatchEffect({
			kind: "dispatch-generate-summary-retry",
			url: "https://example.com/article",
			attempt: 2,
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

		expect(publishEvent).toHaveBeenCalledWith(CrawlArticleFailedEvent, {
			url: "https://example.com/article",
			reason: "exceeded SQS maxReceiveCount",
			receiveCount: 4,
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

		expect(publishEvent).toHaveBeenCalledWith(RecrawlCompletedEvent, {
			url: "https://example.com/article",
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

	it("publishes a CrawlArticleCompletedEvent for a publish-crawl-article-completed effect, carrying only the url in detail", async () => {
		const dispatchGenerateSummary = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const { dispatchEffect } = initLambdaEffectDispatcher({
			dispatchGenerateSummary,
			publishEvent,
		});

		await dispatchEffect({
			kind: "publish-crawl-article-completed",
			url: "https://example.com/article",
		});

		expect(publishEvent).toHaveBeenCalledWith(CrawlArticleCompletedEvent, {
			url: "https://example.com/article",
		});
		expect(dispatchGenerateSummary).not.toHaveBeenCalled();
	});

	it("publishes a CanonicalContentChangedEvent for a publish-canonical-content-changed effect, carrying only the url in detail", async () => {
		const dispatchGenerateSummary = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const { dispatchEffect } = initLambdaEffectDispatcher({
			dispatchGenerateSummary,
			publishEvent,
		});

		await dispatchEffect({
			kind: "publish-canonical-content-changed",
			url: "https://example.com/article",
		});

		expect(publishEvent).toHaveBeenCalledWith(CanonicalContentChangedEvent, {
			url: "https://example.com/article",
		});
		expect(dispatchGenerateSummary).not.toHaveBeenCalled();
	});

	it("publishes a LinkSavedEvent for a publish-link-saved effect, carrying url and userId in detail", async () => {
		const dispatchGenerateSummary = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const { dispatchEffect } = initLambdaEffectDispatcher({
			dispatchGenerateSummary,
			publishEvent,
		});

		await dispatchEffect({
			kind: "publish-link-saved",
			url: "https://example.com/article",
			userId: "user-123",
		});

		expect(publishEvent).toHaveBeenCalledWith(LinkSavedEvent, {
			url: "https://example.com/article",
			userId: "user-123",
		});
		expect(dispatchGenerateSummary).not.toHaveBeenCalled();
	});

	it("publishes an AnonymousLinkSavedEvent for a publish-anonymous-link-saved effect, carrying only the url in detail", async () => {
		const dispatchGenerateSummary = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const { dispatchEffect } = initLambdaEffectDispatcher({
			dispatchGenerateSummary,
			publishEvent,
		});

		await dispatchEffect({
			kind: "publish-anonymous-link-saved",
			url: "https://example.com/article",
		});

		expect(publishEvent).toHaveBeenCalledWith(AnonymousLinkSavedEvent, {
			url: "https://example.com/article",
		});
		expect(dispatchGenerateSummary).not.toHaveBeenCalled();
	});

	it("publishes a SummaryGeneratedEvent for a publish-summary-generated effect, carrying url and token counts in detail", async () => {
		const dispatchGenerateSummary = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const { dispatchEffect } = initLambdaEffectDispatcher({
			dispatchGenerateSummary,
			publishEvent,
		});

		await dispatchEffect({
			kind: "publish-summary-generated",
			url: "https://example.com/article",
			inputTokens: 1234,
			outputTokens: 567,
		});

		expect(publishEvent).toHaveBeenCalledWith(SummaryGeneratedEvent, {
			url: "https://example.com/article",
			inputTokens: 1234,
			outputTokens: 567,
		});
		expect(dispatchGenerateSummary).not.toHaveBeenCalled();
	});

	it("publishes a SubmitLinkCommand for a dispatch-submit-link effect with only the url when no userId/rawHtml are set (anonymous /view save)", async () => {
		const dispatchGenerateSummary = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const { dispatchEffect } = initLambdaEffectDispatcher({
			dispatchGenerateSummary,
			publishEvent,
		});

		await dispatchEffect({
			kind: "dispatch-submit-link",
			url: "https://example.com/article",
		});

		expect(publishEvent).toHaveBeenCalledWith(SubmitLinkCommand, {
			url: "https://example.com/article",
		});
		expect(dispatchGenerateSummary).not.toHaveBeenCalled();
	});

	it("includes userId in a SubmitLinkCommand detail so the submit-link handler can write the save to the authenticated user's library", async () => {
		const dispatchGenerateSummary = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const { dispatchEffect } = initLambdaEffectDispatcher({
			dispatchGenerateSummary,
			publishEvent,
		});

		await dispatchEffect({
			kind: "dispatch-submit-link",
			url: "https://example.com/article",
			userId: "user-123",
		});

		expect(publishEvent).toHaveBeenCalledWith(SubmitLinkCommand, {
			url: "https://example.com/article",
			userId: "user-123",
		});
	});

	it("includes rawHtml in a SubmitLinkCommand detail so the submit-link handler can write the tier-0 source for extension uploads", async () => {
		const dispatchGenerateSummary = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const { dispatchEffect } = initLambdaEffectDispatcher({
			dispatchGenerateSummary,
			publishEvent,
		});

		await dispatchEffect({
			kind: "dispatch-submit-link",
			url: "https://example.com/article",
			userId: "user-123",
			rawHtml: "<html>captured DOM</html>",
		});

		expect(publishEvent).toHaveBeenCalledWith(SubmitLinkCommand, {
			url: "https://example.com/article",
			userId: "user-123",
			rawHtml: "<html>captured DOM</html>",
		});
	});

	it("publishes a SummaryGenerationFailedEvent for a publish-summary-generation-failed effect, carrying url/reason/receiveCount in detail", async () => {
		const dispatchGenerateSummary = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const { dispatchEffect } = initLambdaEffectDispatcher({
			dispatchGenerateSummary,
			publishEvent,
		});

		await dispatchEffect({
			kind: "publish-summary-generation-failed",
			url: "https://example.com/article",
			reason: "exceeded SQS maxReceiveCount",
			receiveCount: 4,
		});

		expect(publishEvent).toHaveBeenCalledWith(SummaryGenerationFailedEvent, {
			url: "https://example.com/article",
			reason: "exceeded SQS maxReceiveCount",
			receiveCount: 4,
		});
		expect(dispatchGenerateSummary).not.toHaveBeenCalled();
	});

	it("publishes a ReaderViewLoadingSucceeded for a publish-reader-view-loading-succeeded effect, carrying url/succeededAt/hasSummary in detail", async () => {
		const dispatchGenerateSummary = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const { dispatchEffect } = initLambdaEffectDispatcher({
			dispatchGenerateSummary,
			publishEvent,
		});

		await dispatchEffect({
			kind: "publish-reader-view-loading-succeeded",
			url: "https://example.com/article",
			succeededAt: "2026-05-30T12:00:00.000Z",
			hasSummary: true,
		});

		expect(publishEvent).toHaveBeenCalledWith(ReaderViewLoadingSucceeded, {
			url: "https://example.com/article",
			succeededAt: "2026-05-30T12:00:00.000Z",
			hasSummary: true,
		});
		expect(dispatchGenerateSummary).not.toHaveBeenCalled();
	});

	it("throws on unknown effect kind so an unhandled variant surfaces as a Lambda failure", async () => {
		const dispatchGenerateSummary = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const { dispatchEffect } = initLambdaEffectDispatcher({
			dispatchGenerateSummary,
			publishEvent,
		});

		await expect(
			dispatchEffect({
				kind: "not-a-real-effect",
				url: "https://example.com/article",
			} as unknown as Effect),
		).rejects.toThrow(/Unhandled aggregate effect/);
	});
});
