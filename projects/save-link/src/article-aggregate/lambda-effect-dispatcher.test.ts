import { initLambdaEffectDispatcher } from "./lambda-effect-dispatcher";

describe("initLambdaEffectDispatcher", () => {
	it("forwards a generate-summary effect to dispatchGenerateSummary", async () => {
		const dispatchGenerateSummary = jest.fn().mockResolvedValue(undefined);

		const { dispatchEffect } = initLambdaEffectDispatcher({
			dispatchGenerateSummary,
		});

		await dispatchEffect({
			kind: "generate-summary",
			url: "https://example.com/article",
		});

		expect(dispatchGenerateSummary).toHaveBeenCalledTimes(1);
		expect(dispatchGenerateSummary).toHaveBeenCalledWith({
			url: "https://example.com/article",
		});
	});

	it("propagates the dispatcher's rejection so the orchestrator's caller can retry", async () => {
		const dispatchGenerateSummary = jest
			.fn()
			.mockRejectedValue(new Error("sqs send failed"));

		const { dispatchEffect } = initLambdaEffectDispatcher({
			dispatchGenerateSummary,
		});

		await expect(
			dispatchEffect({
				kind: "generate-summary",
				url: "https://example.com/article",
			}),
		).rejects.toThrow("sqs send failed");
	});
});
