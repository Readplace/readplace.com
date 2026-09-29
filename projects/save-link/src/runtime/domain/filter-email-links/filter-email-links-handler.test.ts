import assert from "node:assert/strict";
import { EmailLinkOrdinalSchema } from "@packages/domain/inbox";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import { noopLogger } from "@packages/hutch-logger";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { ReadlistDefinitionData } from "@packages/provider-contracts/article-store";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import type { DecideEmailLinks } from "./decide-email-links";
import { initFilterEmailLinksHandler } from "./filter-email-links-handler";

const USER = "00000000000000000000000000000001";
const RAM = "2026-09-23T09:00:00.000Z#<m-1@example.com>";
const WORK = ReadlistSlugSchema.parse("a1b2c3d4");
const PURPOSE = "Engineering practice: code review, testing, and shipping small changes.";

const TRIAGED = {
	userId: USER,
	receivedAtMessageId: RAM,
	readlist: "a1b2c3d4",
	senderEmail: "news@example.com",
	subject: "This week in software",
	links: [
		{ ordinal: "0000", url: "https://a.test/small-prs", anchorText: "Ship small PRs" },
		{ ordinal: "0002", url: "https://b.test/sale", anchorText: "Our spring sale" },
		{ ordinal: "0005", url: "https://c.test/testing", anchorText: "Testing in production" },
	],
};

function workDefinition(purpose: string | undefined): ReadlistDefinitionData {
	return {
		slug: WORK,
		label: "Work",
		createdAt: new Date("2026-09-01T00:00:00.000Z"),
		...(purpose === undefined ? {} : { purpose }),
	};
}

const keepsTheFirstAndLast: DecideEmailLinks = async () => ({
	kept: [EmailLinkOrdinalSchema.parse("0000"), EmailLinkOrdinalSchema.parse("0005")],
	dropped: [
		{ ordinal: EmailLinkOrdinalSchema.parse("0002"), reason: "A product sale, not engineering practice." },
	],
	inputTokens: 900,
	outputTokens: 4000,
	reasoningTokens: 3500,
});

function makeHarness(opts: {
	definitions?: ReadlistDefinitionData[];
	decideEmailLinks?: DecideEmailLinks;
	publishEvent?: PublishEvent;
}) {
	const published: { detailType: string; detail: unknown }[] = [];
	const decisions: Parameters<DecideEmailLinks>[0][] = [];
	const definitionReads: UserId[] = [];
	const decide = opts.decideEmailLinks ?? keepsTheFirstAndLast;
	const handler = initFilterEmailLinksHandler({
		listReadlistDefinitions: async (userId) => {
			definitionReads.push(userId);
			return opts.definitions ?? [workDefinition(PURPOSE)];
		},
		decideEmailLinks: async (input) => {
			decisions.push(input);
			return decide(input);
		},
		publishEvent:
			opts.publishEvent ??
			(async (event, detail) => {
				published.push({ detailType: event.detailType, detail });
			}),
		logger: noopLogger,
	});
	const run = (detail: unknown) =>
		handler(
			buildSqsEvent([{ messageId: "rec-1", body: JSON.stringify({ detail }) }]),
			buildLambdaContext(),
			() => {},
		);
	return { published, decisions, definitionReads, run };
}

const submitted = (published: { detailType: string; detail: unknown }[]) =>
	published.filter((entry) => entry.detailType === "SubmitLinkCommand").map((entry) => entry.detail);

describe("initFilterEmailLinksHandler", () => {
	describe("a readlist with a purpose", () => {
		it("saves only the links the decider keeps, into the routed readlist", async () => {
			const harness = makeHarness({});

			const result = await harness.run(TRIAGED);

			assert(result);
			expect(result.batchItemFailures).toEqual([]);
			expect(submitted(harness.published)).toEqual([
				{
					url: "https://a.test/small-prs",
					userId: USER,
					provenance: { kind: "email", senderEmail: "news@example.com" },
					readlist: "a1b2c3d4",
				},
				{
					url: "https://c.test/testing",
					userId: USER,
					provenance: { kind: "email", senderEmail: "news@example.com" },
					readlist: "a1b2c3d4",
				},
			]);
		});

		it("asks the decider once, with the readlist's purpose and the email's links", async () => {
			const harness = makeHarness({});

			await harness.run(TRIAGED);

			expect(harness.decisions).toEqual([
				{
					purpose: PURPOSE,
					subject: "This week in software",
					senderEmail: "news@example.com",
					links: TRIAGED.links,
				},
			]);
			expect(harness.definitionReads).toEqual([USER]);
		});

		it("announces the decision last, with every dropped link's reason and the tokens it cost", async () => {
			const harness = makeHarness({});

			await harness.run(TRIAGED);

			expect(harness.published.map((entry) => entry.detailType)).toEqual([
				"SubmitLinkCommand",
				"SubmitLinkCommand",
				"EmailLinksFiltered",
			]);
			expect(harness.published.at(-1)?.detail).toEqual({
				userId: USER,
				receivedAtMessageId: RAM,
				readlist: "a1b2c3d4",
				savedTo: "a1b2c3d4",
				readlistLabel: "Work",
				decision: "filtered",
				dropped: [{ ordinal: "0002", reason: "A product sale, not engineering practice." }],
				inputTokens: 900,
				outputTokens: 4000,
				reasoningTokens: 3500,
			});
		});

		it("saves nothing and still announces the decision when nothing fits", async () => {
			const harness = makeHarness({
				decideEmailLinks: async (input) => ({
					kept: [],
					dropped: input.links.map((link) => ({ ordinal: link.ordinal, reason: "Off topic." })),
					inputTokens: 1,
					outputTokens: 2,
					reasoningTokens: 3,
				}),
			});

			await harness.run(TRIAGED);

			expect(harness.published.map((entry) => entry.detailType)).toEqual(["EmailLinksFiltered"]);
		});

		it("fails the record when the decider fails, so the queue retries it and nothing is announced", async () => {
			const harness = makeHarness({
				decideEmailLinks: async () => {
					throw new Error("DeepSeek timed out");
				},
			});

			const result = await harness.run(TRIAGED);

			assert(result);
			expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
			expect(harness.published).toEqual([]);
		});

		it("fails the record without announcing when a save command cannot be published", async () => {
			const published: string[] = [];
			const harness = makeHarness({
				publishEvent: async (event) => {
					if (event.detailType === "SubmitLinkCommand") throw new Error("event bus unavailable");
					published.push(event.detailType);
				},
			});

			const result = await harness.run(TRIAGED);

			assert(result);
			expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
			expect(published).toEqual([]);
		});
	});

	it("saves every link to the readlist without asking the model when the readlist has no purpose", async () => {
		const harness = makeHarness({ definitions: [workDefinition(undefined)] });

		await harness.run(TRIAGED);

		expect(harness.decisions).toEqual([]);
		expect(submitted(harness.published)).toHaveLength(3);
		expect(submitted(harness.published)).toEqual(
			TRIAGED.links.map((link) => expect.objectContaining({ url: link.url, readlist: "a1b2c3d4" })),
		);
		expect(harness.published.at(-1)?.detail).toEqual(
			expect.objectContaining({
				savedTo: "a1b2c3d4",
				readlistLabel: "Work",
				decision: "no-purpose",
				dropped: [],
				inputTokens: 0,
				outputTokens: 0,
				reasoningTokens: 0,
			}),
		);
	});

	it("saves every link to All when the routed readlist no longer exists", async () => {
		const harness = makeHarness({ definitions: [] });

		await harness.run(TRIAGED);

		expect(harness.decisions).toEqual([]);
		expect(submitted(harness.published)).toEqual(
			TRIAGED.links.map((link) => expect.objectContaining({ url: link.url, readlist: "default" })),
		);
		expect(harness.published.at(-1)?.detail).toEqual(
			expect.objectContaining({
				readlist: "a1b2c3d4",
				savedTo: "default",
				readlistLabel: "All",
				decision: "readlist-missing",
				dropped: [],
			}),
		);
	});

	it("fails a triage aimed at All, which is never filtered", async () => {
		const harness = makeHarness({});

		const result = await harness.run({ ...TRIAGED, readlist: "default" });

		assert(result);
		expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
		expect(harness.published).toEqual([]);
	});

	it("fails a triage with no links", async () => {
		const harness = makeHarness({});

		const result = await harness.run({ ...TRIAGED, links: [] });

		assert(result);
		expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
	});

	it("fails a triage whose link ordinal is malformed", async () => {
		const harness = makeHarness({});

		const result = await harness.run({
			...TRIAGED,
			links: [{ ordinal: "7", url: "https://a.test/x", anchorText: "" }],
		});

		assert(result);
		expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
		expect(harness.definitionReads).toEqual([]);
	});
});
