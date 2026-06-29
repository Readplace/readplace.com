import assert from "node:assert/strict";
import { PaymentMethodIdSchema } from "@packages/provider-contracts/payment-methods";
import type { SavedCard } from "@packages/provider-contracts/payment-methods";
import { initInMemoryPaymentMethods } from "./in-memory-payment-methods";

const PRIMARY = PaymentMethodIdSchema.parse("pm_primary");
const BACKUP = PaymentMethodIdSchema.parse("pm_backup");

function card(id: string, isPrimary: boolean): SavedCard {
	return {
		id: PaymentMethodIdSchema.parse(id),
		brand: "visa",
		last4: "4242",
		expMonth: 12,
		expYear: 2030,
		isPrimary,
	};
}

describe("initInMemoryPaymentMethods", () => {
	it("returns no cards for a customer that was never seeded", async () => {
		const provider = initInMemoryPaymentMethods();
		assert.deepEqual(await provider.listCards({ customerId: "cus_unknown" }), []);
	});

	it("seedCards derives isPrimary from the seeded primary card", async () => {
		const provider = initInMemoryPaymentMethods();
		provider.seedCards({
			customerId: "cus_abc",
			cards: [card("pm_primary", true), card("pm_backup", false)],
		});

		const cards = await provider.listCards({ customerId: "cus_abc" });

		assert.equal(cards.length, 2);
		assert.equal(cards[0].id, PRIMARY);
		assert.equal(cards[0].isPrimary, true);
		assert.equal(cards[1].id, BACKUP);
		assert.equal(cards[1].isPrimary, false);
	});

	it("seedCards with no primary leaves every card a backup", async () => {
		const provider = initInMemoryPaymentMethods();
		provider.seedCards({ customerId: "cus_abc", cards: [card("pm_a", false), card("pm_b", false)] });

		const cards = await provider.listCards({ customerId: "cus_abc" });

		assert.deepEqual(
			cards.map((c) => c.isPrimary),
			[false, false],
		);
	});

	it("beginAddCard returns a unique client secret each call", async () => {
		const provider = initInMemoryPaymentMethods();
		const first = await provider.beginAddCard({ customerId: "cus_abc" });
		const second = await provider.beginAddCard({ customerId: "cus_abc" });

		assert.notEqual(first.clientSecret, second.clientSecret);
		assert.match(first.clientSecret, /^seti_inmem_\d+_secret$/);
	});

	it("setPrimaryCard flips which card lists as primary", async () => {
		const provider = initInMemoryPaymentMethods();
		provider.seedCards({
			customerId: "cus_abc",
			cards: [card("pm_primary", true), card("pm_backup", false)],
		});

		await provider.setPrimaryCard({ customerId: "cus_abc", cardId: BACKUP });

		const cards = await provider.listCards({ customerId: "cus_abc" });
		assert.equal(cards.find((c) => c.id === BACKUP)?.isPrimary, true);
		assert.equal(cards.find((c) => c.id === PRIMARY)?.isPrimary, false);
	});

	it("removeCard detaches the target and is a noop for an unknown card", async () => {
		const provider = initInMemoryPaymentMethods();
		provider.seedCards({
			customerId: "cus_abc",
			cards: [card("pm_primary", true), card("pm_backup", false)],
		});

		await provider.removeCard({ customerId: "cus_abc", cardId: BACKUP });
		await provider.removeCard({ customerId: "cus_abc", cardId: PaymentMethodIdSchema.parse("pm_missing") });

		const cards = await provider.listCards({ customerId: "cus_abc" });
		assert.deepEqual(
			cards.map((c) => c.id),
			[PRIMARY],
		);
	});
});
