import assert from "node:assert/strict";
import { parseStripePriceId } from "./stripe-price-id";

const NAME = "STRIPE_PRICE_ID_YEARLY";
const VALID = "price_1UBWhyBjoaOLiPzvWN2sNbBe";

function parse(value: string): string {
	return parseStripePriceId({ name: NAME, value });
}

describe("parseStripePriceId", () => {
	it("accepts a well-formed price id and returns it unchanged", () => {
		assert.equal(parse(VALID), VALID);
	});

	it("rejects the single dash a `gh secret set --body -` writes when it is read as a literal rather than as stdin, as in the 2026-09-03 incident that shipped an unusable price to prod", () => {
		assert.throws(() => parse("-"), /STRIPE_PRICE_ID_YEARLY/);
	});

	it("rejects an empty string", () => {
		assert.throws(() => parse(""), /STRIPE_PRICE_ID_YEARLY/);
	});

	it("rejects a masked secret", () => {
		assert.throws(() => parse("***"), /STRIPE_PRICE_ID_YEARLY/);
	});

	it("rejects a product id, which is the neighbouring Stripe object and the easiest one to paste by mistake", () => {
		assert.throws(() => parse("prod_VBuW6EAgdnpQ9T"), /STRIPE_PRICE_ID_YEARLY/);
	});

	it("rejects a price id embedded in surrounding text", () => {
		assert.throws(() => parse(`pre-${VALID}`), /STRIPE_PRICE_ID_YEARLY/);
	});

	it("rejects a trailing newline", () => {
		assert.throws(() => parse(`${VALID}\n`), /STRIPE_PRICE_ID_YEARLY/);
	});

	it("rejects a truncated id", () => {
		assert.throws(() => parse("price_1UBWh"), /STRIPE_PRICE_ID_YEARLY/);
	});

	it("reports the variable name and the length without leaking the value", () => {
		assert.throws(() => parse("price_!!!!!!!!!!"), {
			message:
				'Environment variable STRIPE_PRICE_ID_YEARLY must be a Stripe price id — "price_" followed by at least 10 alphanumerics; got 16 characters (value not shown)',
		});
	});
});
