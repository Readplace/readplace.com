import {
	InboxAddressSchema,
	type InboxEmailEntry,
	type InboxEmailStatus,
	MessageIdSchema,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import {
	type InboxEmailLinkSummary,
	toInboxEmailsViewModel,
} from "./inbox-emails.viewmodel";

const USER = UserIdSchema.parse("user-1");
const NOW = new Date("2026-06-24T12:00:00.000Z");

function entry(overrides: Partial<InboxEmailEntry> = {}): InboxEmailEntry {
	const messageId = MessageIdSchema.parse("<m-1@example.com>");
	return {
		userId: USER,
		receivedAtMessageId: "2026-06-24T11:59:30.000Z#<m-1@example.com>",
		messageId,
		recipientAddress: InboxAddressSchema.parse("in-3f9a2c@read.place"),
		senderEmail: "news@example.com",
		subject: "Weekly digest",
		status: "received",
		receivedAt: "2026-06-24T11:59:30.000Z",
		rawEmailS3Key: "inbound/m-1",
		bodyS3Key: "content/m-1/content.html",
		...overrides,
	};
}

function build(
	entries: InboxEmailEntry[],
	summaries: Record<string, InboxEmailLinkSummary> = {},
) {
	return toInboxEmailsViewModel(entries, {
		now: NOW,
		linkSummaries: new Map(Object.entries(summaries)),
	});
}

function ago(ms: number): string {
	return new Date(NOW.getTime() - ms).toISOString();
}

describe("toInboxEmailsViewModel", () => {
	it("flags an empty list", () => {
		expect(build([]).isEmpty).toBe(true);
	});

	it("builds a flag-carrying detail link from the URL-encoded sort key", () => {
		const vm = build([entry({ receivedAtMessageId: "2026-06-24T09:00:00.000Z#<a@x>" })]);

		expect(vm.isEmpty).toBe(false);
		expect(vm.rows[0].href).toBe(
			`/inbox/${encodeURIComponent("2026-06-24T09:00:00.000Z#<a@x>")}?feature=email`,
		);
	});

	it("falls back to placeholders for an empty sender or subject", () => {
		const vm = build([entry({ senderEmail: "", subject: "" })]);

		expect(vm.rows[0].sender).toBe("(unknown sender)");
		expect(vm.rows[0].subject).toBe("(no subject)");
	});

	it("badges non-received statuses with a label, leaving received unbadged", () => {
		const cases: { status: InboxEmailStatus; needsBadge: boolean; label: string }[] = [
			{ status: "received", needsBadge: false, label: "Received" },
			{ status: "unparsed", needsBadge: true, label: "Couldn’t render" },
			{ status: "rejected", needsBadge: true, label: "Rejected" },
		];
		for (const { status, needsBadge, label } of cases) {
			const [row] = build([entry({ status })]).rows;
			expect(row.needsBadge).toBe(needsBadge);
			expect(row.statusLabel).toBe(label);
		}
	});

	it("shows a link-count label for a received email with extracted links", () => {
		const sk = "2026-06-24T11:59:30.000Z#<m-1@example.com>";
		const vm = build([entry()], { [sk]: { count: 12, truncated: false } });

		expect(vm.rows[0].linkCountLabel).toBe("12 links");
	});

	it("marks a truncated count and omits the label when there are no links", () => {
		const sk = "2026-06-24T11:59:30.000Z#<m-1@example.com>";
		expect(build([entry()], { [sk]: { count: 200, truncated: true } }).rows[0].linkCountLabel).toBe(
			"200+ links",
		);
		expect(build([entry()], { [sk]: { count: 0, truncated: false } }).rows[0].linkCountLabel).toBeUndefined();
		expect(build([entry()]).rows[0].linkCountLabel).toBeUndefined();
	});

	it("never labels a rejected or unparsed row even if a count is present", () => {
		const sk = "2026-06-24T11:59:30.000Z#<m-1@example.com>";
		const vm = build([entry({ status: "unparsed" })], { [sk]: { count: 5, truncated: false } });

		expect(vm.rows[0].linkCountLabel).toBeUndefined();
	});

	it("formats the received time as a relative LocalTime across each granularity", () => {
		const rows = build([
			entry({ receivedAt: ago(30_000) }),
			entry({ receivedAt: ago(5 * 60_000) }),
			entry({ receivedAt: ago(3 * 3_600_000) }),
			entry({ receivedAt: ago(2 * 86_400_000) }),
		]).rows;

		expect(rows.map((row) => row.received.label)).toEqual([
			"just now",
			"5m ago",
			"3h ago",
			"2d ago",
		]);
		expect(rows.every((row) => row.received.mode === "relative")).toBe(true);
	});

	it("falls back to a UTC-baselined absolute date past the 30-day cutoff", () => {
		const iso = ago(60 * 86_400_000);
		const [row] = build([entry({ receivedAt: iso })]).rows;

		expect(row.received).toEqual({
			iso,
			label: "Apr 25, 2026",
			mode: "date",
		});
	});
});
