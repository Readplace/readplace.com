import assert from "node:assert/strict";
import { InboxAddressSchema } from "../inbox/inbox-address.schema";
import { pickerDeliveryMode, resolveGmailDeliveryMode } from "./gmail-delivery-mode";

const DESTINATION = InboxAddressSchema.parse("tech-a7b2c9@read.place");

describe("resolveGmailDeliveryMode", () => {
	it("keeps the mode a reader chose for a sender", () => {
		assert.equal(resolveGmailDeliveryMode({ deliveryMode: "both" }), "both");
	});

	it("reads a mapping saved before readers could choose as delivering links", () => {
		assert.equal(resolveGmailDeliveryMode({ deliveryMode: undefined }), "links");
	});
});

describe("pickerDeliveryMode", () => {
	it("offers the issue itself for a sender the reader has never mapped", () => {
		assert.equal(pickerDeliveryMode(undefined), "issue");
	});

	it("offers the issue itself for a sender whose mail was seen but never mapped", () => {
		assert.equal(pickerDeliveryMode({ deliveryMode: undefined, mappedAddresses: undefined }), "issue");
	});

	it("keeps links preselected for a mapping saved before readers could choose", () => {
		assert.equal(pickerDeliveryMode({ deliveryMode: undefined, mappedAddresses: [DESTINATION] }), "links");
	});

	it("preselects the mode a mapped sender already uses", () => {
		assert.equal(pickerDeliveryMode({ deliveryMode: "issue", mappedAddresses: [DESTINATION] }), "issue");
	});
});
