import assert from "node:assert/strict";
import { InvoiceIdSchema, type InvoiceSummary } from "@packages/provider-contracts/subscription-billing";
import { buildAccountInvoicesViewModel } from "./account-invoices.view-model";

function paidInvoice(input: { id: string; number: string; issuedAt: string; amountPaidMinor: number }): InvoiceSummary {
	return {
		id: InvoiceIdSchema.parse(input.id),
		number: input.number,
		issuedAt: input.issuedAt,
		amountPaidMinor: input.amountPaidMinor,
		currency: "usd",
		hostedInvoiceUrl: `https://invoice.stripe.com/i/acct_test/${input.id}`,
	};
}

const SEPTEMBER = paidInvoice({
	id: "in_sep",
	number: "RP-0003",
	issuedAt: "2026-09-18T00:00:00.000Z",
	amountPaidMinor: 1000,
});
const AUGUST = paidInvoice({
	id: "in_aug",
	number: "RP-0002",
	issuedAt: "2026-08-18T00:00:00.000Z",
	amountPaidMinor: 0,
});
const JULY = paidInvoice({
	id: "in_jul",
	number: "RP-0001",
	issuedAt: "2026-07-18T00:00:00.000Z",
	amountPaidMinor: 1000,
});

const NEWER_HREF = "/account/invoices?before=in_sep&utm_source=account-invoices&utm_medium=internal&utm_content=newer";
const OLDER_HREF = "/account/invoices?after=in_jul&utm_source=account-invoices&utm_medium=internal&utm_content=older";

describe("buildAccountInvoicesViewModel", () => {
	it("lists each paid invoice newest first with its date, number, the amount actually paid and Stripe's hosted page", () => {
		const vm = buildAccountInvoicesViewModel({
			kind: "loaded",
			cursor: undefined,
			invoices: [SEPTEMBER, AUGUST, JULY],
			hasMore: false,
		});

		assert.equal(vm.state, "list");
		assert.equal(vm.isList, true);
		assert.equal(vm.isEmpty, false);
		assert.deepEqual(vm.rows, [
			{
				date: { iso: "2026-09-18T00:00:00.000Z", label: "Sep 18, 2026", mode: "date" },
				number: "RP-0003",
				amount: "$10.00",
				href: "https://invoice.stripe.com/i/acct_test/in_sep",
			},
			{
				date: { iso: "2026-08-18T00:00:00.000Z", label: "Aug 18, 2026", mode: "date" },
				number: "RP-0002",
				amount: "$0.00",
				href: "https://invoice.stripe.com/i/acct_test/in_aug",
			},
			{
				date: { iso: "2026-07-18T00:00:00.000Z", label: "Jul 18, 2026", mode: "date" },
				number: "RP-0001",
				amount: "$10.00",
				href: "https://invoice.stripe.com/i/acct_test/in_jul",
			},
		]);
	});

	it("links back to the account page with the page's own UTM", () => {
		const vm = buildAccountInvoicesViewModel({
			kind: "loaded",
			cursor: undefined,
			invoices: [SEPTEMBER],
			hasMore: false,
		});

		assert.equal(vm.backHref, "/account?utm_source=account-invoices&utm_medium=internal&utm_content=back");
	});

	it.each([
		["the first page with older invoices", undefined, true, { newer: undefined, older: OLDER_HREF }],
		["a page after a cursor with older invoices", { startingAfter: InvoiceIdSchema.parse("in_oct") }, true, { newer: NEWER_HREF, older: OLDER_HREF }],
		["a page after a cursor that reaches the oldest invoice", { startingAfter: InvoiceIdSchema.parse("in_oct") }, false, { newer: NEWER_HREF, older: undefined }],
		["a page before a cursor with newer invoices", { endingBefore: InvoiceIdSchema.parse("in_jun") }, true, { newer: NEWER_HREF, older: OLDER_HREF }],
		["a page before a cursor that reaches the newest invoice", { endingBefore: InvoiceIdSchema.parse("in_jun") }, false, { newer: undefined, older: OLDER_HREF }],
	] as const)("pages %s: Newer before the newest row, Older after the oldest", (_case, cursor, hasMore, ends) => {
		const vm = buildAccountInvoicesViewModel({
			kind: "loaded",
			cursor,
			invoices: [SEPTEMBER, AUGUST, JULY],
			hasMore,
		});

		assert.deepEqual(vm.pager, { state: "visible", newerHref: ends.newer, olderHref: ends.older });
	});

	it("hides the pager on a lone first page, where neither end has a neighbour", () => {
		const vm = buildAccountInvoicesViewModel({
			kind: "loaded",
			cursor: undefined,
			invoices: [SEPTEMBER, AUGUST, JULY],
			hasMore: false,
		});

		assert.deepEqual(vm.pager, { state: "hidden", newerHref: undefined, olderHref: undefined });
	});

	it("shows the empty state, with no rows and no pager, when the customer has no paid invoice", () => {
		const vm = buildAccountInvoicesViewModel({ kind: "loaded", cursor: undefined, invoices: [], hasMore: false });

		assert.equal(vm.state, "empty");
		assert.equal(vm.isList, false);
		assert.equal(vm.isEmpty, true);
		assert.deepEqual(vm.rows, []);
		assert.equal(vm.pager.state, "hidden");
		assert.equal(vm.backHref, "/account?utm_source=account-invoices&utm_medium=internal&utm_content=back");
	});

	it("shows the empty state for a reader with no billing customer, whose invoices cannot exist", () => {
		const vm = buildAccountInvoicesViewModel({ kind: "no-customer" });

		assert.equal(vm.state, "empty");
		assert.equal(vm.isEmpty, true);
		assert.deepEqual(vm.rows, []);
	});

	it("degrades a failed invoice read to the error state, with neither the list nor the empty copy", () => {
		const vm = buildAccountInvoicesViewModel({ kind: "provider-error" });

		assert.equal(vm.state, "provider-error");
		assert.equal(vm.isList, false);
		assert.equal(vm.isEmpty, false);
		assert.deepEqual(vm.rows, []);
		assert.equal(vm.pager.state, "hidden");
		assert.equal(vm.backHref, "/account?utm_source=account-invoices&utm_medium=internal&utm_content=back");
	});
});
