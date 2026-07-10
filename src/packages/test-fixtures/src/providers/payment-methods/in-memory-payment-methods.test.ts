import assert from "node:assert/strict";
import {
	CardSetupIdSchema,
	PaymentMethodIdSchema,
} from "@packages/provider-contracts/payment-methods";
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

	it("beginAddCard hands back the setup id its client secret is derived from", async () => {
		const provider = initInMemoryPaymentMethods();
		const begun = await provider.beginAddCard({ customerId: "cus_abc" });

		assert.match(begun.setupId, /^seti_inmem_\d+$/);
		assert.equal(begun.clientSecret, `${begun.setupId}_secret`);
	});

	it("getCardSetupResult reports a begun-but-unconfirmed setup as failed", async () => {
		const provider = initInMemoryPaymentMethods();
		const { setupId } = await provider.beginAddCard({ customerId: "cus_abc" });

		const result = await provider.getCardSetupResult({ setupId });

		assert.deepEqual(result, {
			status: "failed",
			customerId: "cus_abc",
			cardId: undefined,
			failureReason: undefined,
		});
	});

	it("getCardSetupResult reports an unknown setup id as failed, mirroring the adapter's 404 mapping", async () => {
		const provider = initInMemoryPaymentMethods();

		const result = await provider.getCardSetupResult({
			setupId: CardSetupIdSchema.parse("seti_never_created"),
		});

		assert.deepEqual(result, {
			status: "failed",
			customerId: undefined,
			cardId: undefined,
			failureReason: undefined,
		});
	});

	it("completeCardSetup succeeds the setup and materialises the client-side attach", async () => {
		const provider = initInMemoryPaymentMethods();
		provider.seedCards({ customerId: "cus_abc", cards: [card("pm_primary", true)] });
		const { setupId } = await provider.beginAddCard({ customerId: "cus_abc" });

		provider.completeCardSetup({ setupId, card: card("pm_new", false) });

		const result = await provider.getCardSetupResult({ setupId });
		assert.deepEqual(result, {
			status: "succeeded",
			customerId: "cus_abc",
			cardId: PaymentMethodIdSchema.parse("pm_new"),
			failureReason: undefined,
		});
		const cards = await provider.listCards({ customerId: "cus_abc" });
		assert.deepEqual(
			cards.map((c) => c.id),
			[PRIMARY, PaymentMethodIdSchema.parse("pm_new")],
		);
	});

	it("completeCardSetup with a primary card promotes it to the funding card", async () => {
		const provider = initInMemoryPaymentMethods();
		provider.seedCards({ customerId: "cus_abc", cards: [card("pm_primary", true)] });
		const { setupId } = await provider.beginAddCard({ customerId: "cus_abc" });

		provider.completeCardSetup({ setupId, card: card("pm_new", true) });

		const cards = await provider.listCards({ customerId: "cus_abc" });
		assert.equal(cards.find((c) => c.id === PaymentMethodIdSchema.parse("pm_new"))?.isPrimary, true);
		assert.equal(cards.find((c) => c.id === PRIMARY)?.isPrimary, false);
	});

	it("failCardSetup fails the setup with the given reason and attaches nothing", async () => {
		const provider = initInMemoryPaymentMethods();
		const { setupId } = await provider.beginAddCard({ customerId: "cus_abc" });

		provider.failCardSetup({ setupId, reason: "card_declined" });

		const result = await provider.getCardSetupResult({ setupId });
		assert.deepEqual(result, {
			status: "failed",
			customerId: "cus_abc",
			cardId: undefined,
			failureReason: "card_declined",
		});
		assert.deepEqual(await provider.listCards({ customerId: "cus_abc" }), []);
	});

	it("completeCardSetup and failCardSetup assert on a setup that was never begun", async () => {
		const provider = initInMemoryPaymentMethods();
		const unknown = CardSetupIdSchema.parse("seti_never_created");

		assert.throws(() => provider.completeCardSetup({ setupId: unknown, card: card("pm_x", false) }), /No card setup/);
		assert.throws(() => provider.failCardSetup({ setupId: unknown }), /No card setup/);
	});
});
