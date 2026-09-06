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
		linkCounts: undefined,
		...overrides,
	};
}

const ADDRESS = { name: "inbox", address: "inbox-3f9a2c@read.place" };

function build(entries: InboxEmailEntry[], activeAddresses = [ADDRESS]) {
	return toInboxEmailsViewModel(
		{ emails: entries, hasNewer: false, hasOlder: false },
		{ now: NOW, activeAddresses },
	);
}

function buildNav(input: { hasNewer: boolean; hasOlder: boolean }) {
	return toInboxEmailsViewModel(
		{
			emails: [
				entry({ receivedAtMessageId: "2026-06-24T10:00:00.000Z#<new@x>" }),
				entry({ receivedAtMessageId: "2026-06-24T09:00:00.000Z#<old@x>" }),
			],
			...input,
		},
		{ now: NOW, activeAddresses: [ADDRESS] },
	);
}

function ago(ms: number): string {
	return new Date(NOW.getTime() - ms).toISOString();
}

describe("toInboxEmailsViewModel", () => {
	it("tells an empty inbox with an address to wait for mail, surfacing it to copy instead of a CTA", () => {
		const { empty } = build([]);

		expect(empty?.key).toBe("no-mail");
		expect(empty?.text).toContain("forward a newsletter to one of your addresses");
		expect(empty?.cta).toBeUndefined();
		expect(empty?.addresses).toEqual([ADDRESS]);
	});

	it("surfaces every active address on an empty inbox, not just the first", () => {
		const second = { name: "my-newsletter", address: "my-newsletter-def456@read.place" };

		const { empty } = build([], [ADDRESS, second]);

		expect(empty?.addresses).toEqual([ADDRESS, second]);
	});

	it("sends an empty inbox with no address to My Emails to create one", () => {
		const { empty } = build([], []);

		expect(empty?.key).toBe("no-address");
		expect(empty?.text).toContain("don't have an inbox email address");
		expect(empty?.cta).toEqual({
			href: "/inbox/addresses?utm_source=inbox-empty&utm_medium=internal&utm_content=create-first-address",
			label: "Create my first inbox address",
		});
		expect(empty?.addresses).toEqual([]);
	});

	it("builds a detail link from the URL-encoded sort key", () => {
		const vm = build([entry({ receivedAtMessageId: "2026-06-24T09:00:00.000Z#<a@x>" })]);

		expect(vm.empty).toBeUndefined();
		expect(vm.rows[0].href).toBe(
			`/inbox/${encodeURIComponent("2026-06-24T09:00:00.000Z#<a@x>")}?utm_source=inbox-emails&utm_medium=internal&utm_content=open-email`,
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
			{ status: "unparsed", needsBadge: true, label: "Couldn't render" },
			{ status: "rejected", needsBadge: true, label: "Rejected" },
		];
		for (const { status, needsBadge, label } of cases) {
			const [row] = build([entry({ status })]).rows;
			expect(row.needsBadge).toBe(needsBadge);
			expect(row.statusLabel).toBe(label);
		}
	});

	it("shows a link-count label for a received email with extracted links", () => {
		const vm = build([entry({ linkCounts: { kept: 12, skipped: 3, truncated: false } })]);

		expect(vm.rows[0].linkCountLabel).toBe("12 links");
	});

	it("marks a truncated count and omits the label when there are no links", () => {
		expect(
			build([entry({ linkCounts: { kept: 200, skipped: 0, truncated: true } })]).rows[0]
				.linkCountLabel,
		).toBe("200+ links");
		expect(
			build([entry({ linkCounts: { kept: 0, skipped: 4, truncated: false } })]).rows[0]
				.linkCountLabel,
		).toBe("");
		expect(build([entry()]).rows[0].linkCountLabel).toBe("");
	});

	it("never labels a rejected or unparsed row even if a count is present", () => {
		const vm = build([
			entry({ status: "unparsed", linkCounts: { kept: 5, skipped: 0, truncated: false } }),
		]);

		expect(vm.rows[0].linkCountLabel).toBe("");
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

	it("hides pagination when the page has no neighbours", () => {
		const vm = buildNav({ hasNewer: false, hasOlder: false });

		expect(vm.showPagination).toBe(false);
		expect(vm.paginationLinks).toEqual([]);
	});

	it("links older from the page's oldest row", () => {
		const vm = buildNav({ hasNewer: false, hasOlder: true });

		expect(vm.showPagination).toBe(true);
		expect(vm.paginationLinks).toEqual([
			{
				key: "older",
				label: "Older",
				iconName: "arrow-right",
				iconLeading: false,
				href: `/inbox?older=${encodeURIComponent("2026-06-24T09:00:00.000Z#<old@x>")}&utm_source=inbox-pagination&utm_medium=internal&utm_content=older`,
			},
		]);
	});

	it("links newer from the page's newest row", () => {
		const vm = buildNav({ hasNewer: true, hasOlder: false });

		expect(vm.paginationLinks).toEqual([
			{
				key: "newer",
				label: "Newer",
				iconName: "arrow-left",
				iconLeading: true,
				href: `/inbox?newer=${encodeURIComponent("2026-06-24T10:00:00.000Z#<new@x>")}&utm_source=inbox-pagination&utm_medium=internal&utm_content=newer`,
			},
		]);
	});

	it("orders newer before older when both neighbours exist", () => {
		const vm = buildNav({ hasNewer: true, hasOlder: true });

		expect(vm.paginationLinks.map((link) => link.key)).toEqual(["newer", "older"]);
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
