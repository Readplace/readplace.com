import assert from "node:assert/strict";
import { aliasNameForSender } from "./alias-name-for-sender";
import { ForwardableSenderSchema } from "./build-forwarding-filter-query";

describe("aliasNameForSender", () => {
	it("names the alias after the publication, not the mail host", () => {
		assert.equal(aliasNameForSender(ForwardableSenderSchema.parse("dan@tldr.tech")), "tldr");
		assert.equal(
			aliasNameForSender(ForwardableSenderSchema.parse("crew@mail.morningbrew.com")),
			"morningbrew",
		);
	});

	it("trims a label the alias grammar would reject at its edges", () => {
		assert.equal(aliasNameForSender(ForwardableSenderSchema.parse("hi@-daily-.news")), "daily");
	});

	it("truncates a label longer than an alias may be", () => {
		assert.equal(
			aliasNameForSender(ForwardableSenderSchema.parse("hi@thisisaveryveryverylongnewsletter.news")),
			"thisisaveryveryverylongn",
		);
	});

	it("falls back to a generic alias when no label survives normalising", () => {
		assert.equal(aliasNameForSender(ForwardableSenderSchema.parse("hi@..tech")), "newsletter");
	});
});
