import { UserIdSchema } from "@packages/domain/user";
import type {
	MarkRelatedPassesRequestedOutcome,
	RelatedPassRequestState,
} from "@packages/provider-contracts/related-articles";
import { initRequestRelatedPasses } from "./request-related-passes";

const READER = UserIdSchema.parse("reader-1");
const ARTICLE_URL = "https://example.com/opened-post";
const REQUESTED_AT = new Date("2026-11-04T09:00:00.000Z");

function initRecordingRequest(params: {
	state: RelatedPassRequestState;
	markOutcome?: MarkRelatedPassesRequestedOutcome;
	failPassesPublish?: Error;
}) {
	const calls: { step: string; params: Record<string, unknown> }[] = [];
	const requestRelatedPasses = initRequestRelatedPasses({
		readRelatedPassRequestState: async (read) => {
			calls.push({ step: "read", params: read });
			return params.state;
		},
		markRelatedPassesRequested: async (mark) => {
			calls.push({ step: "stamp", params: mark });
			return params.markOutcome ?? "marked";
		},
		publishComputeRelatedPasses: async (publish) => {
			if (params.failPassesPublish) throw params.failPassesPublish;
			calls.push({ step: "passes", params: publish });
		},
		publishComputeRelatedPastReads: async (publish) => {
			calls.push({ step: "past-reads", params: publish });
		},
	});
	return { requestRelatedPasses, calls };
}

describe("initRequestRelatedPasses", () => {
	it("asks for both passes and then stamps the row when Next read was never requested", async () => {
		const { requestRelatedPasses, calls } = initRecordingRequest({ state: { saved: true } });

		await requestRelatedPasses({ userId: READER, url: ARTICLE_URL });

		expect(calls).toEqual([
			{ step: "read", params: { userId: READER, url: ARTICLE_URL } },
			{ step: "passes", params: { url: ARTICLE_URL, userId: READER } },
			{ step: "stamp", params: { userId: READER, url: ARTICLE_URL } },
		]);
	});

	it("asks for Past reads alone when Next read was already requested", async () => {
		const { requestRelatedPasses, calls } = initRecordingRequest({
			state: { saved: true, requestedAt: REQUESTED_AT },
		});

		await requestRelatedPasses({ userId: READER, url: ARTICLE_URL });

		expect(calls).toEqual([
			{ step: "read", params: { userId: READER, url: ARTICLE_URL } },
			{ step: "past-reads", params: { userId: READER, url: ARTICLE_URL } },
		]);
	});

	it.each(["ready", "skipped"] as const)(
		"asks for Past reads alone once Next read settled %s",
		async (nextRead) => {
			const { requestRelatedPasses, calls } = initRecordingRequest({
				state: { saved: true, nextRead },
			});

			await requestRelatedPasses({ userId: READER, url: ARTICLE_URL });

			expect(calls).toEqual([
				{ step: "read", params: { userId: READER, url: ARTICLE_URL } },
				{ step: "past-reads", params: { userId: READER, url: ARTICLE_URL } },
			]);
		},
	);

	it("asks for Past reads alone for a row deleted before the read", async () => {
		const { requestRelatedPasses, calls } = initRecordingRequest({ state: { saved: false } });

		await requestRelatedPasses({ userId: READER, url: ARTICLE_URL });

		expect(calls).toEqual([
			{ step: "read", params: { userId: READER, url: ARTICLE_URL } },
			{ step: "past-reads", params: { userId: READER, url: ARTICLE_URL } },
		]);
	});

	it("carries the source reading list on the Past reads request", async () => {
		const { requestRelatedPasses, calls } = initRecordingRequest({
			state: { saved: true, nextRead: "ready" },
		});

		await requestRelatedPasses({ userId: READER, url: ARTICLE_URL, readlist: "work" });

		expect(calls).toEqual([
			{ step: "read", params: { userId: READER, url: ARTICLE_URL } },
			{ step: "past-reads", params: { userId: READER, url: ARTICLE_URL, readlist: "work" } },
		]);
	});

	it("publishes before it stamps, so a failed publish leaves the row unstamped", async () => {
		const outage = new Error("EventBridge unavailable");
		const { requestRelatedPasses, calls } = initRecordingRequest({
			state: { saved: true },
			failPassesPublish: outage,
		});

		await expect(requestRelatedPasses({ userId: READER, url: ARTICLE_URL })).rejects.toBe(outage);

		expect(calls).toEqual([
			{ step: "read", params: { userId: READER, url: ARTICLE_URL } },
		]);
	});

	it("finishes when the row is deleted between the publish and the stamp", async () => {
		const { requestRelatedPasses, calls } = initRecordingRequest({
			state: { saved: true },
			markOutcome: "row-absent",
		});

		await requestRelatedPasses({ userId: READER, url: ARTICLE_URL });

		expect(calls).toEqual([
			{ step: "read", params: { userId: READER, url: ARTICLE_URL } },
			{ step: "passes", params: { url: ARTICLE_URL, userId: READER } },
			{ step: "stamp", params: { userId: READER, url: ARTICLE_URL } },
		]);
	});
});
