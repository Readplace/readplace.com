import assert from "node:assert";
import {
	type InvoiceId,
	InvoiceIdSchema,
	type InvoiceSummary,
} from "@packages/provider-contracts/subscription-billing";
import { type LocalTime, toAbsoluteDate, withInternalTracking } from "@packages/web-shell";
import { z } from "zod";
import { ACCOUNT_INVOICES_URL, buildAccountUrl } from "./account.url";
import { formatChargeAmount } from "./billing-amount";

const ACCOUNT_INVOICES_SOURCE = "account-invoices";

export type InvoiceCursor = { startingAfter: InvoiceId } | { endingBefore: InvoiceId } | undefined;

export const InvoiceCursorQuerySchema = z.union([
	z.object({ after: z.undefined(), before: z.undefined() }).transform((): InvoiceCursor => undefined),
	z
		.object({ after: InvoiceIdSchema, before: z.undefined() })
		.transform((query): InvoiceCursor => ({ startingAfter: query.after })),
	z
		.object({ after: z.undefined(), before: InvoiceIdSchema })
		.transform((query): InvoiceCursor => ({ endingBefore: query.before })),
]);

export type AccountInvoicesFetch =
	| { kind: "no-customer" }
	| { kind: "provider-error" }
	| { kind: "loaded"; cursor: InvoiceCursor; invoices: InvoiceSummary[]; hasMore: boolean };

export interface InvoiceRowView {
	date: LocalTime;
	number: string;
	amount: string;
	href: string;
}

export type InvoicesPagerState = "visible" | "hidden";

export interface InvoicesPagerViewModel {
	state: InvoicesPagerState;
	newerHref: string | undefined;
	olderHref: string | undefined;
}

export interface AccountInvoicesViewModel {
	state: "list" | "empty" | "provider-error";
	isList: boolean;
	isEmpty: boolean;
	rows: InvoiceRowView[];
	backHref: string;
	pager: InvoicesPagerViewModel;
}

const BACK_HREF = withInternalTracking(buildAccountUrl(), {
	source: ACCOUNT_INVOICES_SOURCE,
	content: "back",
});

const HIDDEN_PAGER: InvoicesPagerViewModel = {
	state: "hidden",
	newerHref: undefined,
	olderHref: undefined,
};

type CursorPosition = "first" | "after" | "before";

function cursorPosition(cursor: InvoiceCursor): CursorPosition {
	if (cursor === undefined) return "first";
	return "startingAfter" in cursor ? "after" : "before";
}

const ENABLED_ENDS: Record<CursorPosition, (hasMore: boolean) => { newer: boolean; older: boolean }> = {
	first: (hasMore) => ({ newer: false, older: hasMore }),
	after: (hasMore) => ({ newer: true, older: hasMore }),
	before: (hasMore) => ({ newer: hasMore, older: true }),
};

function pagerHref(input: { param: "before" | "after"; id: InvoiceId; content: "newer" | "older" }): string {
	const search = new URLSearchParams({ [input.param]: input.id });
	return withInternalTracking(`${ACCOUNT_INVOICES_URL}?${search.toString()}`, {
		source: ACCOUNT_INVOICES_SOURCE,
		content: input.content,
	});
}

function buildPager(page: {
	cursor: InvoiceCursor;
	newest: InvoiceSummary;
	oldest: InvoiceSummary;
	hasMore: boolean;
}): InvoicesPagerViewModel {
	const ends = ENABLED_ENDS[cursorPosition(page.cursor)](page.hasMore);
	if (!ends.newer && !ends.older) return HIDDEN_PAGER;
	return {
		state: "visible",
		newerHref: ends.newer
			? pagerHref({ param: "before", id: page.newest.id, content: "newer" })
			: undefined,
		olderHref: ends.older
			? pagerHref({ param: "after", id: page.oldest.id, content: "older" })
			: undefined,
	};
}

function toRow(invoice: InvoiceSummary): InvoiceRowView {
	return {
		date: toAbsoluteDate({ iso: invoice.issuedAt }),
		number: invoice.number,
		amount: formatChargeAmount({ amountMinor: invoice.amountPaidMinor, currency: invoice.currency }),
		href: invoice.hostedInvoiceUrl,
	};
}

const EMPTY_INVOICES: AccountInvoicesViewModel = {
	state: "empty",
	isList: false,
	isEmpty: true,
	rows: [],
	backHref: BACK_HREF,
	pager: HIDDEN_PAGER,
};

export function buildAccountInvoicesViewModel(fetched: AccountInvoicesFetch): AccountInvoicesViewModel {
	if (fetched.kind === "provider-error") {
		return { ...EMPTY_INVOICES, state: "provider-error", isEmpty: false };
	}
	if (fetched.kind === "no-customer") {
		return EMPTY_INVOICES;
	}
	const [newest] = fetched.invoices;
	if (newest === undefined) {
		return EMPTY_INVOICES;
	}
	const oldest = fetched.invoices.at(-1);
	assert(oldest, "a page with a newest invoice also has an oldest one");
	return {
		state: "list",
		isList: true,
		isEmpty: false,
		rows: fetched.invoices.map(toRow),
		backHref: BACK_HREF,
		pager: buildPager({ cursor: fetched.cursor, newest, oldest, hasMore: fetched.hasMore }),
	};
}
