import assert from "node:assert/strict";
import {
	AGE_RANGES,
	type AgeAccessDecision,
	type AgeRange,
	type ParentalApproval,
	decideAgeAccess,
} from "./age-access";

describe("decideAgeAccess", () => {
	it.each<[ParentalApproval]>([["none-reported"], ["approved"], ["pending"], ["denied"], ["revoked"]])(
		"refuses an under-13 user whatever the parental approval (%s)",
		(parentalApproval) => {
			assert.equal(decideAgeAccess({ ageRange: "under-13", parentalApproval }), "refused:under-13");
		},
	);

	it.each<[AgeRange, ParentalApproval, AgeAccessDecision]>([
		["13-15", "none-reported", "allowed"],
		["13-15", "approved", "allowed"],
		["16-17", "none-reported", "allowed"],
		["16-17", "approved", "allowed"],
		["18-plus", "none-reported", "allowed"],
		["18-plus", "approved", "allowed"],
		["13-15", "pending", "refused:parental-approval-missing"],
		["13-15", "denied", "refused:parental-approval-missing"],
		["16-17", "revoked", "refused:parental-approval-missing"],
		["18-plus", "pending", "refused:parental-approval-missing"],
	])("decides %s with approval %s as %s", (ageRange, parentalApproval, expected) => {
		assert.equal(decideAgeAccess({ ageRange, parentalApproval }), expected);
	});

	it("lists the four store-reported ranges", () => {
		assert.deepEqual(AGE_RANGES, ["under-13", "13-15", "16-17", "18-plus"]);
	});
});
