import { DEFAULT_READLIST_SLUG } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemorySubmitLink } from "./in-memory-submit-link";

describe("initInMemorySubmitLink", () => {
	it("records every submitted link in order", async () => {
		const submitLink = initInMemorySubmitLink();
		const userId = UserIdSchema.parse("00000000000000000000000000000001");
		const first = { url: "https://archive.ph/Ab1cD", userId, provenance: { kind: "import" as const }, readlist: DEFAULT_READLIST_SLUG };
		const second = { ...first, url: "https://archive.ph/Zz9yX" };

		await submitLink.publishSubmitLink(first);
		await submitLink.publishSubmitLink(second);

		expect(submitLink.submitLinks).toEqual([first, second]);
	});
});
