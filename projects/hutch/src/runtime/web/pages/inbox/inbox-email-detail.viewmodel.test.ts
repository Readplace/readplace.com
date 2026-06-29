import {
	InboxAddressSchema,
	type InboxEmailEntry,
	type InboxEmailStatus,
	MessageIdSchema,
} from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { toInboxEmailDetailViewModel } from "./inbox-email-detail.viewmodel";

function entry(overrides: Partial<InboxEmailEntry> = {}): InboxEmailEntry {
	return {
		userId: UserIdSchema.parse("user-1"),
		receivedAtMessageId: "2026-06-24T09:00:00.000Z#<m@x>",
		messageId: MessageIdSchema.parse("<m@x>"),
		recipientAddress: InboxAddressSchema.parse("in-3f9a2c@read.place"),
		senderEmail: "news@example.com",
		subject: "Weekly digest",
		status: "received",
		receivedAt: "2026-06-24T09:00:00.000Z",
		rawEmailS3Key: "inbound/m",
		bodyS3Key: "content/m/content.html",
		...overrides,
	};
}

describe("toInboxEmailDetailViewModel", () => {
	it("renders the body for a received email with content, View tab active", () => {
		const vm = toInboxEmailDetailViewModel({
			entry: entry({ status: "received" }),
			bodyHtml: "<p>hi</p>",
		});

		expect(vm.canRenderBody).toBe(true);
		expect(vm.bodyHtml).toBe("<p>hi</p>");
		expect(vm.tabs[0].ariaCurrent).toBe("page");
	});

	it("exposes the received instant as a UTC-baselined datetime LocalTime", () => {
		const vm = toInboxEmailDetailViewModel({
			entry: entry({ receivedAt: "2026-06-24T09:00:00.000Z" }),
			bodyHtml: "<p>hi</p>",
		});

		expect(vm.received).toEqual({
			iso: "2026-06-24T09:00:00.000Z",
			label: "24 June 2026, 09:00 UTC",
			mode: "datetime",
		});
	});

	it("shows the unavailable panel for a received email whose body is not readable", () => {
		const vm = toInboxEmailDetailViewModel({
			entry: entry({ status: "received" }),
			bodyHtml: undefined,
		});

		expect(vm.canRenderBody).toBe(false);
		expect(vm.bodyHtml).toBe("");
	});

	it("never renders the body for a rejected or unparsed email", () => {
		const statuses: InboxEmailStatus[] = ["rejected", "unparsed"];
		for (const status of statuses) {
			const vm = toInboxEmailDetailViewModel({
				entry: entry({ status }),
				bodyHtml: "<p>should be ignored</p>",
			});
			expect(vm.canRenderBody).toBe(false);
		}
	});

	it("falls back to placeholders for an empty sender or subject", () => {
		const vm = toInboxEmailDetailViewModel({
			entry: entry({ senderEmail: "", subject: "" }),
			bodyHtml: undefined,
		});

		expect(vm.sender).toBe("(unknown sender)");
		expect(vm.subject).toBe("(no subject)");
	});
});
