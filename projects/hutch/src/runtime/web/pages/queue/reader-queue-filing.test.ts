import { QueueSlugSchema } from "@packages/domain/queue";
import { buildReaderQueueFiling } from "./reader-queue-filing";

const WORK = QueueSlugSchema.parse("work");
const LATER = QueueSlugSchema.parse("later");

describe("buildReaderQueueFiling", () => {
	it("offers nothing when the reader owns no queues", () => {
		const filing = buildReaderQueueFiling({
			articleId: "abc123",
			definitions: [],
			saves: [{}],
			returnTo: "/queue/abc123/view",
			markStatusConfirmGated: false,
		});

		expect(filing).toEqual({
			tags: undefined,
			picker: undefined,
			markStatusConfirmQueueLabels: undefined,
		});
	});

	it("splits owned queues into tags for memberships and picker options for the rest", () => {
		const filing = buildReaderQueueFiling({
			articleId: "abc123",
			definitions: [
				{ slug: WORK, label: "Work", createdAt: new Date("2026-08-01T00:00:00.000Z") },
				{ slug: LATER, label: "Later", createdAt: new Date("2026-08-01T00:00:00.000Z") },
			],
			saves: [{}, { queue: WORK }],
			returnTo: "/queue/abc123/view",
			markStatusConfirmGated: false,
		});

		expect(filing.tags).toEqual({
			unassignUrl: "/queue/abc123/unassign",
			returnTo: "/queue/abc123/view",
			tags: [{ slug: WORK, label: "Work" }],
		});
		expect(filing.picker).toEqual({
			assignUrl: "/queue/abc123/assign",
			returnTo: "/queue/abc123/view",
			options: [{ slug: LATER, label: "Later" }],
		});
	});

	it("retires the picker once every owned queue holds the article", () => {
		const filing = buildReaderQueueFiling({
			articleId: "abc123",
			definitions: [
				{ slug: WORK, label: "Work", createdAt: new Date("2026-08-01T00:00:00.000Z") },
				{ slug: LATER, label: "Later", createdAt: new Date("2026-08-01T00:00:00.000Z") },
			],
			saves: [{}, { queue: WORK }, { queue: LATER }],
			returnTo: "/queue/abc123/view",
			markStatusConfirmGated: false,
		});

		expect(filing.picker).toBeUndefined();
		expect(filing.tags?.tags).toEqual([
			{ slug: WORK, label: "Work" },
			{ slug: LATER, label: "Later" },
		]);
	});

	it("names every queue the article sits in, default first, once the confirmation is gated on", () => {
		const filing = buildReaderQueueFiling({
			articleId: "abc123",
			definitions: [
				{ slug: WORK, label: "Work", createdAt: new Date("2026-08-01T00:00:00.000Z") },
				{ slug: LATER, label: "Later", createdAt: new Date("2026-08-01T00:00:00.000Z") },
			],
			saves: [{}, { queue: LATER }],
			returnTo: "/queue/abc123/view",
			markStatusConfirmGated: true,
		});

		expect(filing.markStatusConfirmQueueLabels).toEqual(["My Queue", "Later"]);
	});

	it("withholds the picker from an article with no default-queue copy to assign from", () => {
		const filing = buildReaderQueueFiling({
			articleId: "abc123",
			definitions: [
				{ slug: WORK, label: "Work", createdAt: new Date("2026-08-01T00:00:00.000Z") },
				{ slug: LATER, label: "Later", createdAt: new Date("2026-08-01T00:00:00.000Z") },
			],
			saves: [{ queue: WORK }],
			returnTo: "/queue/abc123/view",
			markStatusConfirmGated: false,
		});

		expect(filing.picker).toBeUndefined();
		expect(filing.tags?.tags).toEqual([{ slug: WORK, label: "Work" }]);
	});
});
