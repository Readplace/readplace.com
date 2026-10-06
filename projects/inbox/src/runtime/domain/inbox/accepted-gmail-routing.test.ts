import assert from "node:assert/strict";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { acceptedGmailRouting } from "./accepted-gmail-routing";

const DESTINATION = InboxAddressSchema.parse("work-abc123@read.place");

describe("acceptedGmailRouting", () => {
	it("replays an accepted Gmail email to the destinations and delivery it was accepted with", () => {
		assert.deepEqual(acceptedGmailRouting({ gmailDestinationAddresses: [DESTINATION], gmailDeliveryMode: "issue" }), {
			kind: "gmail",
			destinationAddresses: [DESTINATION],
			deliveryMode: "issue",
		});
	});

	it("replays a Gmail email accepted before delivery modes existed as delivering links", () => {
		assert.deepEqual(acceptedGmailRouting({ gmailDestinationAddresses: [DESTINATION], gmailDeliveryMode: undefined }), {
			kind: "gmail",
			destinationAddresses: [DESTINATION],
			deliveryMode: "links",
		});
	});

	it("has no Gmail routing for an email that reached an inbox address directly", () => {
		assert.equal(acceptedGmailRouting({ gmailDestinationAddresses: undefined, gmailDeliveryMode: undefined }), undefined);
	});
});
