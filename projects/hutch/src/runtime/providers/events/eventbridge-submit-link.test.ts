import { SaveAttemptIdSchema } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { SubmitLinkCommand } from "@packages/hutch-infra-components";
import { initEventBridgeSubmitLink } from "./eventbridge-submit-link";

describe("initEventBridgeSubmitLink", () => {
	it("publishes the link as a SubmitLinkCommand the save-link worker accepts", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const { publishSubmitLink } = initEventBridgeSubmitLink({ publishEvent });
		const params = {
			url: "https://archive.ph/Ab1cD",
			userId: UserIdSchema.parse("00000000000000000000000000000001"),
			provenance: { kind: "import" as const },
			readlist: DEFAULT_READLIST_SLUG,
			saveAttemptId: SaveAttemptIdSchema.parse("attempt-1"),
		};

		await publishSubmitLink(params);

		expect(publishEvent).toHaveBeenCalledWith(SubmitLinkCommand, params);
		expect(SubmitLinkCommand.detailSchema.safeParse(params).success).toBe(true);
	});
});
