import { UserIdSchema } from "@packages/domain/user";
import { ComputeRelatedPassesCommand } from "@packages/infra-components";
import { initEventBridgeComputeRelatedPasses } from "./eventbridge-compute-related-passes";

describe("initEventBridgeComputeRelatedPasses", () => {
	it("publishes the request as a ComputeRelatedPassesCommand the related-passes worker accepts", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const { publishComputeRelatedPasses } = initEventBridgeComputeRelatedPasses({ publishEvent });
		const params = {
			url: "https://example.com/post",
			userId: UserIdSchema.parse("00000000000000000000000000000001"),
		};

		await publishComputeRelatedPasses(params);

		expect(publishEvent).toHaveBeenCalledWith(ComputeRelatedPassesCommand, params);
		expect(ComputeRelatedPassesCommand.detailSchema.safeParse(params).success).toBe(true);
	});
});
