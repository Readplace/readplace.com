import assert from "node:assert";
import type { UserId } from "@packages/domain/user";
import {
	INVOICE_PAGE_SIZE,
	type CancelSubscriptionImmediately,
	type CreateSubscriptionOnExistingCustomer,
	type FindSubscriptionNextCharge,
	type InvoiceId,
	type InvoiceSummary,
	type ListInvoices,
	type OnUnpaidFirstInvoice,
	type ReverseScheduledCancellation,
	type ScheduleCancellationAtPeriodEnd,
	type SubscriptionNextCharge,
} from "@packages/provider-contracts/subscription-billing";

/** Fixed cancellationEffectiveAt for the in-memory provider. Tests that need a
 * specific period-end can override it via `scheduleCancellationAtPeriodEndReturns`. */
const DEFAULT_PERIOD_END = "2026-06-22T10:00:00.000Z";

export function initInMemorySubscriptionBilling(opts?: {
	createSubscriptionFails?: boolean;
	scheduleCancellationFails?: boolean;
	reverseScheduledCancellationFails?: boolean;
	scheduleCancellationAtPeriodEndReturns?: string;
	reverseScheduledCancellationReturns?: { trialEndsAt?: string };
}): {
	cancelImmediately: CancelSubscriptionImmediately;
	createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer;
	findSubscriptionNextCharge: FindSubscriptionNextCharge;
	scheduleCancellationAtPeriodEnd: ScheduleCancellationAtPeriodEnd;
	reverseScheduledCancellation: ReverseScheduledCancellation;
	cancelledSubscriptionIds: () => readonly string[];
	createdSubscriptions: () => readonly {
		customerId: string;
		priceId: string;
		userId: UserId;
		onUnpaidFirstInvoice: OnUnpaidFirstInvoice;
		subscriptionId: string;
	}[];
	scheduledCancellations: () => readonly { subscriptionId: string; cancellationEffectiveAt: string }[];
	reversedCancellations: () => readonly string[];
	seedNextCharge: (input: { subscriptionId: string; nextCharge: SubscriptionNextCharge }) => void;
	failNextChargeLookup: () => void;
	nextChargeLookups: () => readonly string[];
	listInvoices: ListInvoices;
	seedInvoices: (input: { customerId: string; invoices: InvoiceSummary[] }) => void;
	failInvoiceLookup: () => void;
	invoiceLookups: () => readonly string[];
} {
	const cancelled: string[] = [];
	const created: {
		customerId: string;
		priceId: string;
		userId: UserId;
		onUnpaidFirstInvoice: OnUnpaidFirstInvoice;
		subscriptionId: string;
	}[] = [];
	const scheduledCancellationCalls: { subscriptionId: string; cancellationEffectiveAt: string }[] = [];
	const reversed: string[] = [];
	const nextCharges = new Map<string, SubscriptionNextCharge>();
	const nextChargeLookupCalls: string[] = [];
	let nextChargeLookupFails = false;
	const invoicesByCustomer = new Map<string, InvoiceSummary[]>();
	const invoiceLookupCalls: string[] = [];
	let invoiceLookupFails = false;
	let nextId = 1;

	const cancelImmediately: CancelSubscriptionImmediately = async ({ subscriptionId }) => {
		cancelled.push(subscriptionId);
	};

	const createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer = async ({
		customerId,
		priceId,
		userId,
		onUnpaidFirstInvoice,
	}) => {
		if (opts?.createSubscriptionFails) {
			throw new Error("In-memory billing createSubscription failure");
		}
		const subscriptionId = `sub_inmem_${nextId++}`;
		created.push({ customerId, priceId, userId, onUnpaidFirstInvoice, subscriptionId });
		return { subscriptionId };
	};

	const scheduleCancellationAtPeriodEnd: ScheduleCancellationAtPeriodEnd = async ({
		subscriptionId,
	}) => {
		if (opts?.scheduleCancellationFails) {
			throw new Error("In-memory billing scheduleCancellationAtPeriodEnd failure");
		}
		const cancellationEffectiveAt =
			opts?.scheduleCancellationAtPeriodEndReturns ?? DEFAULT_PERIOD_END;
		scheduledCancellationCalls.push({ subscriptionId, cancellationEffectiveAt });
		return { cancellationEffectiveAt };
	};

	const reverseScheduledCancellation: ReverseScheduledCancellation = async ({
		subscriptionId,
	}) => {
		if (opts?.reverseScheduledCancellationFails) {
			throw new Error("In-memory billing reverseScheduledCancellation failure");
		}
		reversed.push(subscriptionId);
		return opts?.reverseScheduledCancellationReturns ?? {};
	};

	/* Seeded per test rather than defaulted: a stock charge date would quietly start
	 * rendering the renewal line in unrelated tests.
	 * The seams are mutators, not constructor options, because the shared fixture
	 * builds this provider with no arguments. */
	const findSubscriptionNextCharge: FindSubscriptionNextCharge = async ({ subscriptionId }) => {
		nextChargeLookupCalls.push(subscriptionId);
		if (nextChargeLookupFails) {
			throw new Error("In-memory billing findSubscriptionNextCharge failure");
		}
		return nextCharges.get(subscriptionId);
	};

	function cursorIndex(invoices: readonly InvoiceSummary[], id: InvoiceId): number {
		const index = invoices.findIndex((invoice) => invoice.id === id);
		assert(index >= 0, `No such invoice: ${id}`);
		return index;
	}

	const listInvoices: ListInvoices = async ({ customerId, cursor }) => {
		invoiceLookupCalls.push(customerId);
		if (invoiceLookupFails) {
			throw new Error("In-memory billing listInvoices failure");
		}
		const newestFirst = [...(invoicesByCustomer.get(customerId) ?? [])].sort((a, b) =>
			b.issuedAt.localeCompare(a.issuedAt),
		);
		if (cursor === undefined) {
			return {
				invoices: newestFirst.slice(0, INVOICE_PAGE_SIZE),
				hasMore: newestFirst.length > INVOICE_PAGE_SIZE,
			};
		}
		if ("startingAfter" in cursor) {
			const older = newestFirst.slice(cursorIndex(newestFirst, cursor.startingAfter) + 1);
			return {
				invoices: older.slice(0, INVOICE_PAGE_SIZE),
				hasMore: older.length > INVOICE_PAGE_SIZE,
			};
		}
		const newer = newestFirst.slice(0, cursorIndex(newestFirst, cursor.endingBefore));
		return {
			invoices: newer.slice(Math.max(0, newer.length - INVOICE_PAGE_SIZE)),
			hasMore: newer.length > INVOICE_PAGE_SIZE,
		};
	};

	return {
		cancelImmediately,
		createSubscriptionOnExistingCustomer,
		findSubscriptionNextCharge,
		scheduleCancellationAtPeriodEnd,
		reverseScheduledCancellation,
		cancelledSubscriptionIds: () => [...cancelled],
		createdSubscriptions: () => [...created],
		scheduledCancellations: () => [...scheduledCancellationCalls],
		reversedCancellations: () => [...reversed],
		seedNextCharge: ({ subscriptionId, nextCharge }) => {
			nextCharges.set(subscriptionId, nextCharge);
		},
		failNextChargeLookup: () => {
			nextChargeLookupFails = true;
		},
		nextChargeLookups: () => [...nextChargeLookupCalls],
		listInvoices,
		seedInvoices: ({ customerId, invoices }) => {
			invoicesByCustomer.set(customerId, [...invoices]);
		},
		failInvoiceLookup: () => {
			invoiceLookupFails = true;
		},
		invoiceLookups: () => [...invoiceLookupCalls],
	};
}
