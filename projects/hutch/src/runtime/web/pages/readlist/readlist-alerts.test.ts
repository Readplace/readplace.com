import { READLIST_MAX_PER_USER } from "@packages/domain/readlist";
import { readlistAlertFor } from "./readlist-alerts";

describe("readlistAlertFor", () => {
	it("titles the readlist limit and tells the reader what to do about it", () => {
		expect(readlistAlertFor({ queue_error: "limit" })).toEqual({
			variant: "error",
			title: { text: "Readlist limit reached", element: "p" },
			message: { text: `You can create up to ${READLIST_MAX_PER_USER} readlists. Delete an existing readlist before creating a new one.` },
		});
	});

	it("titles a vanished readlist and points at the rail", () => {
		expect(readlistAlertFor({ queue_error: "unknown_readlist" })).toEqual({
			variant: "error",
			title: { text: "Readlist not found", element: "p" },
			message: { text: "This readlist no longer exists. Select another readlist to continue." },
		});
	});

	it("explains a refused rename with the same wording the rename route answers", () => {
		expect(readlistAlertFor({ queue_error: "rename_invalid-name" })).toEqual({
			variant: "error",
			title: { text: "Couldn't rename the readlist", element: "p" },
			message: { text: "Give the readlist a name of 24 characters or fewer." },
		});
		expect(readlistAlertFor({ queue_error: "rename_unknown-readlist" })?.message).toEqual({
			text: "That readlist no longer exists.",
		});
	});

	it("explains a refused create with the same wording the dialog shows inline", () => {
		expect(readlistAlertFor({ queue_error: "create_invalid-name" })).toEqual({
			variant: "error",
			title: { text: "Couldn't create the readlist", element: "p" },
			message: { text: "Give the readlist a name of 24 characters or fewer." },
		});
		expect(readlistAlertFor({ queue_error: "create_reserved-name" })).toEqual({
			variant: "error",
			title: { text: "Couldn't create the readlist", element: "p" },
			message: { text: "Pick a name other than All, the readlist that holds every save." },
		});
		expect(readlistAlertFor({ queue_error: "create_name-taken" })).toEqual({
			variant: "error",
			title: { text: "Couldn't create the readlist", element: "p" },
			message: { text: "You already have a readlist with that name, so pick another one." },
		});
	});

	it("tells the reader a saved wrapper link is queued, as a notice rather than an error", () => {
		expect(readlistAlertFor({ queue_error: "save_queued" })).toEqual({
			variant: "info",
			message: { text: "This link is queued while Readplace finds the original article." },
		});
	});

	it("renders no alert without a known code", () => {
		expect(readlistAlertFor({})).toBeUndefined();
		expect(readlistAlertFor({ queue_error: "made-up" })).toBeUndefined();
		expect(readlistAlertFor({ queue_error: ["limit"] })).toBeUndefined();
	});

	it("renders no alert for a code that names an inherited object member", () => {
		expect(readlistAlertFor({ queue_error: "toString" })).toBeUndefined();
		expect(readlistAlertFor({ queue_error: "constructor" })).toBeUndefined();
	});
});
