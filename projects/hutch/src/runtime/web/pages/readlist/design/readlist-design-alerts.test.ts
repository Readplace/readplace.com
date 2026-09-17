import { READLIST_MAX_PER_USER } from "@packages/domain/readlist";
import { readlistDesignAlertFor } from "./readlist-design-alerts";

describe("readlistDesignAlertFor", () => {
	it("titles the readlist limit and tells the reader what to do about it", () => {
		expect(readlistDesignAlertFor({ queue_error: "limit" })).toEqual({
			code: "limit",
			title: "Readlist limit reached",
			body: `You can create up to ${READLIST_MAX_PER_USER} readlists. Delete an existing readlist before creating a new one.`,
		});
	});

	it("titles a vanished readlist and points at the rail", () => {
		expect(readlistDesignAlertFor({ queue_error: "unknown_readlist" })).toEqual({
			code: "unknown_readlist",
			title: "Readlist not found",
			body: "This readlist no longer exists. Select another readlist to continue.",
		});
	});

	it("explains a refused rename with the same wording the rename route answers", () => {
		expect(readlistDesignAlertFor({ queue_error: "rename_invalid-name" })).toEqual({
			code: "rename_invalid-name",
			title: "Couldn't rename the readlist",
			body: "Give the readlist a name of 24 characters or fewer.",
		});
		expect(readlistDesignAlertFor({ queue_error: "rename_unknown-readlist" })?.body).toBe(
			"That readlist no longer exists.",
		);
	});

	it("renders no alert without a known code", () => {
		expect(readlistDesignAlertFor({})).toBeUndefined();
		expect(readlistDesignAlertFor({ queue_error: "made-up" })).toBeUndefined();
		expect(readlistDesignAlertFor({ queue_error: ["limit"] })).toBeUndefined();
	});
});
