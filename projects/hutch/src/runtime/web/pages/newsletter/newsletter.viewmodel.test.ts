import { ReaderArticleHashIdSchema } from "@packages/domain/article";
import {
	NewsletterMessageIdSchema,
	type NewsletterMessage,
} from "@packages/domain/newsletter";
import { UserIdSchema } from "@packages/domain/user";
import {
	formatReceivedAt,
	toNewsletterDetailViewModel,
	toNewsletterListViewModel,
} from "./newsletter.viewmodel";

const ARTICLE_ID = "a".repeat(32);

describe("formatReceivedAt", () => {
	it("formats an ISO instant as a stable UTC label", () => {
		expect(formatReceivedAt("2026-06-05T09:07:00.000Z")).toBe("5 Jun 2026, 09:07 UTC");
	});
});

describe("toNewsletterListViewModel", () => {
	it("builds rows with hrefs and substitutes a placeholder for blank subjects", () => {
		const vm = toNewsletterListViewModel({
			address: "abc@inbox.test",
			messages: [
				{ id: NewsletterMessageIdSchema.parse("m1"), subject: "Hello", receivedAt: "2026-06-05T00:00:00.000Z", savedCount: 2 },
				{ id: NewsletterMessageIdSchema.parse("m2"), subject: "", receivedAt: "2026-06-04T00:00:00.000Z", savedCount: 0 },
			],
		});

		expect(vm.address).toBe("abc@inbox.test");
		expect(vm.hasInbox).toBe(true);
		expect(vm.hasMessages).toBe(true);
		expect(vm.messages[0]).toMatchObject({ id: "m1", subject: "Hello", savedCount: 2, href: "/newsletter/m1" });
		expect(vm.messages[1].subject).toBe("(no subject)");
	});

	it("flags hasMessages=false for an empty inbox", () => {
		const vm = toNewsletterListViewModel({ address: "a@b", messages: [] });
		expect(vm.hasInbox).toBe(true);
		expect(vm.hasMessages).toBe(false);
		expect(vm.messages).toEqual([]);
	});

	it("flags hasInbox=false when address is undefined", () => {
		const vm = toNewsletterListViewModel({ address: undefined, messages: [] });
		expect(vm.hasInbox).toBe(false);
		expect(vm.address).toBe("");
	});
});

describe("toNewsletterDetailViewModel", () => {
	const base: NewsletterMessage = {
		id: NewsletterMessageIdSchema.parse("m1"),
		userId: UserIdSchema.parse("user-1"),
		subject: "Weekly",
		fromAddress: "news@example.com",
		receivedAt: "2026-06-05T09:00:00.000Z",
		html: "<p>Body</p>",
		savedLinks: [
			{ url: "https://example.com/a", articleId: ReaderArticleHashIdSchema.parse(ARTICLE_ID) },
		],
		skippedCount: 1,
	};

	it("maps links to reader hrefs, renders the body into a srcdoc, and surfaces skipped count", () => {
		const vm = toNewsletterDetailViewModel(base);

		expect(vm.subject).toBe("Weekly");
		expect(vm.hasLinks).toBe(true);
		expect(vm.savedCount).toBe(1);
		expect(vm.links[0]).toEqual({
			displayUrl: "https://example.com/a",
			href: `/queue/${ARTICLE_ID}/view`,
		});
		expect(vm.srcdoc).toContain("<p>Body</p>");
		expect(vm.hasSkipped).toBe(true);
		expect(vm.skippedCount).toBe(1);
	});

	it("uses the no-subject placeholder and clears the link/skip flags when empty", () => {
		const vm = toNewsletterDetailViewModel({ ...base, subject: "", savedLinks: [], skippedCount: 0 });
		expect(vm.subject).toBe("(no subject)");
		expect(vm.hasLinks).toBe(false);
		expect(vm.hasSkipped).toBe(false);
	});
});
