import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import {
	InvoiceIdSchema,
	type InvoiceSummary,
} from "@packages/provider-contracts/subscription-billing";
import { initInMemorySubscriptionBilling } from "./in-memory-subscription-billing";

const USER_ID = UserIdSchema.parse("usr_inmem_test");

describe("initInMemorySubscriptionBilling", () => {
	it("records each cancelImmediately call for assertion", async () => {
		const stripe = initInMemorySubscriptionBilling();

		await stripe.cancelImmediately({ subscriptionId: "sub_one" });
		await stripe.cancelImmediately({ subscriptionId: "sub_two" });

		assert.deepEqual(stripe.cancelledSubscriptionIds(), ["sub_one", "sub_two"]);
	});

	it("returns an empty list before any cancellations", () => {
		const stripe = initInMemorySubscriptionBilling();
		assert.deepEqual(stripe.cancelledSubscriptionIds(), []);
	});

	it("returns a fresh snapshot on each call so successive cancellations show up", async () => {
		const stripe = initInMemorySubscriptionBilling();
		await stripe.cancelImmediately({ subscriptionId: "sub_x" });
		const first = stripe.cancelledSubscriptionIds();

		await stripe.cancelImmediately({ subscriptionId: "sub_y" });
		const second = stripe.cancelledSubscriptionIds();

		assert.deepEqual(first, ["sub_x"]);
		assert.deepEqual(second, ["sub_x", "sub_y"]);
	});

	it("createSubscriptionOnExistingCustomer returns synthetic subscription ids and records params", async () => {
		const stripe = initInMemorySubscriptionBilling();

		const first = await stripe.createSubscriptionOnExistingCustomer({
			customerId: "cus_existing",
			priceId: "price_abc",
			userId: USER_ID,
			onUnpaidFirstInvoice: "refuse",
		});
		const second = await stripe.createSubscriptionOnExistingCustomer({
			customerId: "cus_existing",
			priceId: "price_abc",
			userId: USER_ID,
			onUnpaidFirstInvoice: "leave-pending",
		});

		assert.notEqual(first.subscriptionId, second.subscriptionId);
		assert.deepEqual(stripe.createdSubscriptions(), [
			{
				customerId: "cus_existing",
				priceId: "price_abc",
				userId: USER_ID,
				onUnpaidFirstInvoice: "refuse",
				subscriptionId: first.subscriptionId,
			},
			{
				customerId: "cus_existing",
				priceId: "price_abc",
				userId: USER_ID,
				onUnpaidFirstInvoice: "leave-pending",
				subscriptionId: second.subscriptionId,
			},
		]);
	});

	it("createSubscriptionOnExistingCustomer throws when configured to fail", async () => {
		const stripe = initInMemorySubscriptionBilling({ createSubscriptionFails: true });

		await assert.rejects(
			() =>
				stripe.createSubscriptionOnExistingCustomer({
					customerId: "cus_x",
					priceId: "price_y",
					userId: USER_ID,
					onUnpaidFirstInvoice: "refuse",
				}),
			/In-memory billing createSubscription failure/,
		);
		assert.deepEqual(stripe.createdSubscriptions(), []);
	});

	it("scheduleCancellationAtPeriodEnd returns the configured cancellationEffectiveAt and records calls", async () => {
		const stripe = initInMemorySubscriptionBilling({
			scheduleCancellationAtPeriodEndReturns: "2026-07-01T00:00:00.000Z",
		});

		const result = await stripe.scheduleCancellationAtPeriodEnd({ subscriptionId: "sub_paid" });

		assert.equal(result.cancellationEffectiveAt, "2026-07-01T00:00:00.000Z");
		assert.deepEqual(stripe.scheduledCancellations(), [
			{ subscriptionId: "sub_paid", cancellationEffectiveAt: "2026-07-01T00:00:00.000Z" },
		]);
	});

	it("scheduleCancellationAtPeriodEnd returns a default cancellationEffectiveAt when none is configured", async () => {
		const stripe = initInMemorySubscriptionBilling();

		const result = await stripe.scheduleCancellationAtPeriodEnd({ subscriptionId: "sub_paid" });

		assert.equal(typeof result.cancellationEffectiveAt, "string");
		assert.ok(Date.parse(result.cancellationEffectiveAt) > 0);
	});

	it("scheduleCancellationAtPeriodEnd throws when configured to fail and does not record the call", async () => {
		const stripe = initInMemorySubscriptionBilling({ scheduleCancellationFails: true });

		await assert.rejects(
			() => stripe.scheduleCancellationAtPeriodEnd({ subscriptionId: "sub_paid" }),
			/In-memory billing scheduleCancellationAtPeriodEnd failure/,
		);
		assert.deepEqual(stripe.scheduledCancellations(), []);
	});

	it("reverseScheduledCancellation records each call so tests can assert the un-cancel path ran", async () => {
		const stripe = initInMemorySubscriptionBilling();

		await stripe.reverseScheduledCancellation({ subscriptionId: "sub_paid" });
		await stripe.reverseScheduledCancellation({ subscriptionId: "sub_other" });

		assert.deepEqual(stripe.reversedCancellations(), ["sub_paid", "sub_other"]);
	});

	it("reverseScheduledCancellation throws when configured to fail and does not record the call", async () => {
		const stripe = initInMemorySubscriptionBilling({ reverseScheduledCancellationFails: true });

		await assert.rejects(
			() => stripe.reverseScheduledCancellation({ subscriptionId: "sub_paid" }),
			/In-memory billing reverseScheduledCancellation failure/,
		);
		assert.deepEqual(stripe.reversedCancellations(), []);
	});

	it("returns nothing for a subscription no test has seeded a charge for", async () => {
		const stripe = initInMemorySubscriptionBilling();

		assert.equal(
			await stripe.findSubscriptionNextCharge({ subscriptionId: "sub_unseeded" }),
			undefined,
		);
		assert.deepEqual(stripe.nextChargeLookups(), ["sub_unseeded"]);
	});

	it("returns the seeded charge for its subscription and records each lookup", async () => {
		const stripe = initInMemorySubscriptionBilling();
		const nextCharge = { at: "2026-08-12T10:00:00.000Z", amountMinor: 4900, currency: "usd" };
		stripe.seedNextCharge({ subscriptionId: "sub_paid", nextCharge });

		assert.deepEqual(
			await stripe.findSubscriptionNextCharge({ subscriptionId: "sub_paid" }),
			nextCharge,
		);
		assert.deepEqual(stripe.nextChargeLookups(), ["sub_paid"]);
	});

	it("throws on lookup once configured to fail, standing in for a provider outage", async () => {
		const stripe = initInMemorySubscriptionBilling();
		stripe.failNextChargeLookup();

		await assert.rejects(
			() => stripe.findSubscriptionNextCharge({ subscriptionId: "sub_paid" }),
			/In-memory billing findSubscriptionNextCharge failure/,
		);
	});

	describe("listInvoices", () => {
		function monthlyInvoices(count: number): InvoiceSummary[] {
			return Array.from({ length: count }, (_, index) => ({
				id: InvoiceIdSchema.parse(`in_test${String(index + 1).padStart(3, "0")}`),
				number: `T-${String(index + 1).padStart(4, "0")}`,
				issuedAt: new Date(Date.UTC(2026, 8 - index, 18)).toISOString(),
				amountPaidMinor: 1000,
				currency: "usd",
				hostedInvoiceUrl: `https://invoice.example/${index + 1}`,
			}));
		}

		function ids(page: { invoices: InvoiceSummary[] }): string[] {
			return page.invoices.map((invoice) => invoice.id);
		}

		it("lists a customer's invoices newest first, twelve to a page, and records each lookup", async () => {
			const stripe = initInMemorySubscriptionBilling();
			stripe.seedInvoices({ customerId: "cus_paying", invoices: monthlyInvoices(13).reverse() });

			const page = await stripe.listInvoices({ customerId: "cus_paying", cursor: undefined });

			assert.deepEqual(ids(page), monthlyInvoices(12).map((invoice) => invoice.id));
			assert.equal(page.hasMore, true);
			assert.deepEqual(stripe.invoiceLookups(), ["cus_paying"]);
		});

		it("pages to the older invoices after a cursor, saying whether still older ones follow", async () => {
			const stripe = initInMemorySubscriptionBilling();
			stripe.seedInvoices({ customerId: "cus_paying", invoices: monthlyInvoices(13) });

			const page = await stripe.listInvoices({
				customerId: "cus_paying",
				cursor: { startingAfter: InvoiceIdSchema.parse("in_test012") },
			});

			assert.deepEqual(ids(page), ["in_test013"]);
			assert.equal(page.hasMore, false);
		});

		it("pages to the newer invoices nearest a cursor, saying whether still newer ones precede them", async () => {
			const stripe = initInMemorySubscriptionBilling();
			stripe.seedInvoices({ customerId: "cus_paying", invoices: monthlyInvoices(14) });

			const nearest = await stripe.listInvoices({
				customerId: "cus_paying",
				cursor: { endingBefore: InvoiceIdSchema.parse("in_test014") },
			});
			const first = await stripe.listInvoices({
				customerId: "cus_paying",
				cursor: { endingBefore: InvoiceIdSchema.parse("in_test013") },
			});

			assert.deepEqual(ids(nearest), monthlyInvoices(13).slice(1).map((invoice) => invoice.id));
			assert.equal(nearest.hasMore, true);
			assert.deepEqual(ids(first), monthlyInvoices(12).map((invoice) => invoice.id));
			assert.equal(first.hasMore, false);
		});

		it("lists nothing for a customer no test has seeded invoices for", async () => {
			const stripe = initInMemorySubscriptionBilling();

			assert.deepEqual(await stripe.listInvoices({ customerId: "cus_new", cursor: undefined }), {
				invoices: [],
				hasMore: false,
			});
		});

		it("rejects a cursor that names no invoice of the customer, as Stripe does", async () => {
			const stripe = initInMemorySubscriptionBilling();
			stripe.seedInvoices({ customerId: "cus_paying", invoices: monthlyInvoices(2) });

			await assert.rejects(
				() =>
					stripe.listInvoices({
						customerId: "cus_paying",
						cursor: { startingAfter: InvoiceIdSchema.parse("in_missing") },
					}),
				/No such invoice: in_missing/,
			);
		});

		it("throws on lookup once configured to fail, standing in for a provider outage", async () => {
			const stripe = initInMemorySubscriptionBilling();
			stripe.failInvoiceLookup();

			await assert.rejects(
				() => stripe.listInvoices({ customerId: "cus_paying", cursor: undefined }),
				/In-memory billing listInvoices failure/,
			);
			assert.deepEqual(stripe.invoiceLookups(), ["cus_paying"]);
		});
	});
});
