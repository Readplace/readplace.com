import {
	InboxAddressSchema,
	type InboxEmailEntry,
	type InboxEmailStatus,
	MessageIdSchema,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { toInboxEmailsViewModel } from "./inbox-emails.viewmodel";

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

function ago(ms: number): string {
	return new Date(NOW.getTime() - ms).toISOString();
}

describe("toInboxEmailsViewModel", () => {
	it("flags an empty list", () => {
		expect(toInboxEmailsViewModel([], { now: NOW }).isEmpty).toBe(true);
	});

	it("builds a flag-carrying detail link from the URL-encoded sort key", () => {
		const vm = toInboxEmailsViewModel(
			[entry({ receivedAtMessageId: "2026-06-24T09:00:00.000Z#<a@x>" })],
			{ now: NOW },
		);

		expect(vm.isEmpty).toBe(false);
		expect(vm.rows[0].href).toBe(
			`/inbox/${encodeURIComponent("2026-06-24T09:00:00.000Z#<a@x>")}?feature=email`,
		);
	});

	it("falls back to placeholders for an empty sender or subject", () => {
		const vm = toInboxEmailsViewModel(
			[entry({ senderEmail: "", subject: "" })],
			{ now: NOW },
		);

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
			const [row] = toInboxEmailsViewModel([entry({ status })], { now: NOW }).rows;
			expect(row.needsBadge).toBe(needsBadge);
			expect(row.statusLabel).toBe(label);
		}
	});

	it("formats the received time as a relative LocalTime across each granularity", () => {
		const rows = toInboxEmailsViewModel(
			[
				entry({ receivedAt: ago(30_000) }),
				entry({ receivedAt: ago(5 * 60_000) }),
				entry({ receivedAt: ago(3 * 3_600_000) }),
				entry({ receivedAt: ago(2 * 86_400_000) }),
			],
			{ now: NOW },
		).rows;

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
		const [row] = toInboxEmailsViewModel([entry({ receivedAt: iso })], { now: NOW }).rows;

		expect(row.received).toEqual({
			iso,
			label: "25 Apr 2026",
			mode: "date",
		});
	});
});
