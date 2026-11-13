import assert from "node:assert/strict";
import type { DeepseekCallFailedLogLine } from "@packages/ai-message";
import { MinutesSchema } from "@packages/domain/article";
import { EmailLinkOrdinalSchema } from "@packages/domain/inbox";
import {
	composeReadlistPurposeText,
	type ReadlistSlug,
	ReadlistSlugSchema,
	readlistFitOverrideId,
	readlistPurposeVersion,
} from "@packages/domain/readlist";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import type { Logger } from "@packages/logger";
import type { PublishEvent } from "@packages/infra-components/runtime";
import type { ReadlistDefinitionData, ReadlistFitOverride } from "@packages/provider-contracts/article-store";
import type { DecideReadlistFit, ReadlistFitResult } from "@packages/readlist-fit";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initInMemoryInboxEmailLink } from "@packages/test-fixtures/providers/inbox-email";
import { initFindSavedArticleForLink } from "@packages/article-store";
import { initResolveCanonicalIdentity } from "@packages/save-article";
import { EmailLinksFilteredEvent, EmailLinksFilterFailedEvent } from "@packages/infra-components";
import type { SubscriptionRecord } from "@packages/provider-contracts/subscription-providers";
import { initFilingsLeftToFile } from "./filings-left-to-file";
import { initAdmitTriagedMessage } from "./triaged-message-admission";
import { initFilterEmailLinksHandler } from "./filter-email-links-handler";
import type { ReadlistFitDecidedLine, ReadlistFitUnsureLine } from "./readlist-fit-log-lines.types";

const USER = "00000000000000000000000000000001";
const RAM = "2026-09-23T09:00:00.000Z#<m-1@example.com>";
const TRIAGED_TIME = "2026-09-23T09:00:00.000Z";
const WORK = ReadlistSlugSchema.parse("a1b2c3d4");
const PURPOSE = "Engineering practice: code review, testing, and shipping small changes.";
const PURPOSE_VERSION = readlistPurposeVersion(PURPOSE);
const EMAIL_PROVENANCE = { kind: "email", senderEmail: "news@example.com" };

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

function choice(params: {
	minutesAgo: number;
	anchorText: string;
	host: string;
	readerVerdict: "keep" | "drop";
}): ReadlistFitOverride {
	const createdAt = new Date(Date.parse("2026-09-23T09:00:00.000Z") - params.minutesAgo * 60_000);
	const ordinal = EmailLinkOrdinalSchema.parse(String(params.minutesAgo % 10_000).padStart(4, "0"));
	const receivedAtMessageId = `2026-09-20T09:00:00.000Z#<m-${params.minutesAgo}@example.com>`;
	return {
		id: readlistFitOverrideId({ createdAt, receivedAtMessageId, ordinal }),
		url: `https://${params.host}/${params.minutesAgo}`,
		anchorText: params.anchorText,
		host: params.host,
		engineVerdict: params.readerVerdict === "keep" ? "drop" : "keep",
		engineReason: "The judge's earlier call.",
		readerVerdict: params.readerVerdict,
		purposeVersion: PURPOSE_VERSION,
		receivedAtMessageId,
		ordinal,
		createdAt,
	};
}

function fitResult(decisions: ReadlistFitResult["decisions"]): ReadlistFitResult {
	return {
		decisions,
		engine: "deepseek-flash",
		model: "deepseek-chat",
		usage: { inputTokens: 900, outputTokens: 4000, reasoningTokens: 3500 },
	};
}

const oneOfEachVerdict: DecideReadlistFit = async () =>
	fitResult([
		{ id: "0000", verdict: "keep", reason: "Shipping small changes." },
		{ id: "0002", verdict: "drop", reason: "A product sale, not engineering practice." },
		{ id: "0005", verdict: "unsure", reason: "Could be about testing or a vendor pitch." },
	]);

function captureLines<T>() {
	const lines: T[] = [];
	const write = (line: T) => {
		lines.push(line);
	};
	const log: Logger.Typed<T> = { info: write, error: write, warn: write, debug: write };
	return { lines, log };
}

type Meta = Parameters<ReturnType<typeof initInMemoryInboxEmailLink>["putLinksMeta"]>[0]["meta"];

const SELECTS_WORK: Meta = {
	truncated: false,
	extractionFailed: false,
	selectedReadlists: [{ readlist: WORK, label: "Work" }],
};

function makeHarness(opts: {
	definitions?: ReadlistDefinitionData[];
	overrides?: ReadlistFitOverride[] | ((read: number) => ReadlistFitOverride[]);
	decideReadlistFit?: DecideReadlistFit;
	publishEvent?: PublishEvent;
	receiveCount?: number;
	meta?: Meta | null;
	subscription?: () => SubscriptionRecord | undefined;
	time?: string;
	publishFails?: (detailType: string) => boolean;
	inboxReadFails?: boolean;
}) {
	const store = initInMemoryArticleStore();
	const inboxLinks = initInMemoryInboxEmailLink();
	const metaSeeded =
		opts.meta === null
			? Promise.resolve()
			: inboxLinks.putLinksMeta({ userId: UserIdSchema.parse(USER), receivedAtMessageId: RAM, meta: opts.meta ?? SELECTS_WORK });
	const logLines: unknown[][] = [];
	const capture = (...args: unknown[]) => {
		logLines.push(args);
	};
	const logger: Logger = { info: capture, error: capture, warn: capture, debug: capture };
	const published: { detailType: string; detail: unknown }[] = [];
	const decisions: Parameters<DecideReadlistFit>[0][] = [];
	const definitionReads: UserId[] = [];
	const overrideReads: { userId: UserId; readlist: ReadlistSlug }[] = [];
	const decide = opts.decideReadlistFit ?? oneOfEachVerdict;
	const fitDecided = captureLines<ReadlistFitDecidedLine>();
	const fitUnsure = captureLines<ReadlistFitUnsureLine>();
	const callFailed = captureLines<DeepseekCallFailedLogLine>();
	let clockMs = Date.parse("2026-09-23T09:00:00.000Z");
	const handler = initFilterEmailLinksHandler({
		listReadlistDefinitions: async (userId) => {
			definitionReads.push(userId);
			return opts.definitions ?? [workDefinition(PURPOSE)];
		},
		listReadlistFitOverrides: async (params) => {
			overrideReads.push(params);
			const overrides = opts.overrides ?? [];
			return typeof overrides === "function" ? overrides(overrideReads.length) : overrides;
		},
		admitTriagedMessage: initAdmitTriagedMessage({
			listLinksByEmail: async (params) => {
				if (opts.inboxReadFails) throw new Error("DynamoDB unavailable");
				return inboxLinks.listLinksByEmail(params);
			},
			findSubscriptionByUserId: async () => opts.subscription?.(),
			now: () => new Date("2026-09-23T09:00:00.000Z"),
		}),
		filingsLeftToFile: initFilingsLeftToFile({
			listReadlistFitOverrides: async (params) => {
				overrideReads.push(params);
				const overrides = opts.overrides ?? [];
				return typeof overrides === "function" ? overrides(overrideReads.length) : overrides;
			},
			findSavedArticleForLink: initFindSavedArticleForLink({
				resolveCanonicalIdentity: initResolveCanonicalIdentity({ findIdentityRow: store.findIdentityRow }),
				findArticleById: store.findArticleById,
			}),
			findReadlistRemoval: store.findReadlistRemoval,
			logger,
		}),
		decideReadlistFit: async (input) => {
			decisions.push(input);
			return decide(input);
		},
		publishEvent:
			opts.publishEvent ??
			(async (event, detail) => {
				if (opts.publishFails?.(event.detailType)) throw new Error("event bus unavailable");
				published.push({ detailType: event.detailType, detail });
				if (event.detailType === EmailLinksFilteredEvent.detailType) {
					const fact = EmailLinksFilteredEvent.detailSchema.parse(detail);
					await inboxLinks.putReadlistOutcome({
						userId: fact.userId,
						receivedAtMessageId: fact.receivedAtMessageId,
						outcome: {
							readlist: ReadlistSlugSchema.parse(fact.readlist),
							readlistLabel: fact.readlistLabel,
							decision: fact.decision,
							fit: fact.fit.map((entry) => ({ ...entry, ordinal: EmailLinkOrdinalSchema.parse(entry.ordinal) })),
						},
					});
				}
				if (event.detailType === EmailLinksFilterFailedEvent.detailType) {
					const fact = EmailLinksFilterFailedEvent.detailSchema.parse(detail);
					await inboxLinks.putReadlistOutcome({
						userId: fact.userId,
						receivedAtMessageId: fact.receivedAtMessageId,
						outcome: { readlist: ReadlistSlugSchema.parse(fact.readlist), readlistLabel: "Work", decision: "failed", fit: [] },
					});
				}
			}),
		logger,
		fitDecidedLog: fitDecided.log,
		fitUnsureLog: fitUnsure.log,
		deepseekCallFailedLog: callFailed.log,
		now: () => {
			clockMs += 250;
			return new Date(clockMs);
		},
	});
	const runBody = async (body: string) => {
		await metaSeeded;
		const event = buildSqsEvent([{ messageId: "rec-1", body }]);
		return handler(
			{
				Records: event.Records.map((record) => ({
					...record,
					attributes: { ...record.attributes, ApproximateReceiveCount: String(opts.receiveCount ?? 1) },
				})),
			},
			buildLambdaContext(),
			() => {},
		);
	};
	const run = (detail: unknown) => runBody(JSON.stringify({ detail, time: opts.time ?? TRIAGED_TIME }));
	const finalOutcome = async () =>
		(await inboxLinks.listLinksByEmail({ userId: UserIdSchema.parse(USER), receivedAtMessageId: RAM })).meta?.readlistOutcomes;
	const saveToAll = (url: string) =>
		store.saveArticle({
			userId: UserIdSchema.parse(USER),
			url,
			metadata: { title: "T", siteName: "S", excerpt: "E", wordCount: 1 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: new Date("2026-09-23T09:00:00.000Z"),
			saveTrigger: "manual",
		});
	const seedFailedOutcome = async () => {
		await metaSeeded;
		await inboxLinks.putReadlistOutcome({
			userId: UserIdSchema.parse(USER),
			receivedAtMessageId: RAM,
			outcome: { readlist: WORK, readlistLabel: "Work", decision: "failed", fit: [] },
		});
	};
	return {
		store,
		inboxLinks,
		saveToAll,
		seedFailedOutcome,
		logLines,
		finalOutcome,
		published,
		decisions,
		definitionReads,
		overrideReads,
		run,
		runBody,
		decidedLines: fitDecided.lines,
		unsureLines: fitUnsure.lines,
		callFailedLines: callFailed.lines,
	};
}

const filings = (published: { detailType: string; detail: unknown }[]) =>
	published.filter((entry) => entry.detailType === "FileArticleIntoReadlistCommand").map((entry) => entry.detail);

const submissions = (published: { detailType: string; detail: unknown }[]) =>
	published.filter((entry) => entry.detailType === "SubmitLinkCommand");

describe("initFilterEmailLinksHandler", () => {
	describe("a readlist with a purpose", () => {
		it("files only the links the judge keeps, with the reason, version and email source", async () => {
			const harness = makeHarness({});

			const result = await harness.run(TRIAGED);

			assert(result);
			expect(result.batchItemFailures).toEqual([]);
			expect(submissions(harness.published)).toEqual([]);
			expect(filings(harness.published)).toEqual([
				{
					url: "https://a.test/small-prs",
					userId: USER,
					readlist: "a1b2c3d4",
					provenance: EMAIL_PROVENANCE,
					fit: {
						verdict: "keep",
						reason: "Shipping small changes.",
						purposeVersion: PURPOSE_VERSION,
						source: { kind: "email", receivedAtMessageId: RAM, ordinal: "0000" },
					},
				},
			]);
		});

		it("asks the judge once, with the parsed purpose, its version, the candidates and the email", async () => {
			const stored = composeReadlistPurposeText({ keep: "Engineering practice", skip: "Product sales" });
			const harness = makeHarness({ definitions: [workDefinition(stored)] });

			await harness.run(TRIAGED);

			expect(harness.decisions).toEqual([
				{
					purpose: {
						keep: "Engineering practice",
						skip: "Product sales",
						version: readlistPurposeVersion(stored),
					},
					examples: [],
					candidates: [
						{ id: "0000", url: "https://a.test/small-prs", text: "Ship small PRs" },
						{ id: "0002", url: "https://b.test/sale", text: "Our spring sale" },
						{ id: "0005", url: "https://c.test/testing", text: "Testing in production" },
					],
					context: { subject: "This week in software", senderEmail: "news@example.com" },
				},
			]);
			expect(harness.definitionReads).toEqual([USER]);
		});

		it("sends the reader's remembered choices as examples, newest first, as text, host and verdict", async () => {
			const harness = makeHarness({
				overrides: [
					choice({ minutesAgo: 1, anchorText: "How to cut a dovetail by hand", host: "finewoodworking.com", readerVerdict: "keep" }),
					choice({ minutesAgo: 2, anchorText: "Spring tool sale", host: "shop.example.com", readerVerdict: "drop" }),
					choice({ minutesAgo: 3, anchorText: "", host: "c.test", readerVerdict: "keep" }),
				],
			});

			await harness.run(TRIAGED);

			expect(harness.overrideReads).toEqual([
				{ userId: USER, readlist: WORK },
				{ userId: USER, readlist: WORK },
			]);
			expect(harness.decisions.map((decision) => decision.examples)).toEqual([
				[
					{ text: "How to cut a dovetail by hand", host: "finewoodworking.com", verdict: "keep" },
					{ text: "Spring tool sale", host: "shop.example.com", verdict: "drop" },
					{ text: "", host: "c.test", verdict: "keep" },
				],
			]);
		});

		it("sends the newest 20 choices when the readlist remembers more", async () => {
			const remembered = Array.from({ length: 23 }, (_, index) =>
				choice({ minutesAgo: index + 1, anchorText: `Choice ${index + 1}`, host: "a.test", readerVerdict: "keep" }),
			);
			const harness = makeHarness({ overrides: remembered });

			await harness.run(TRIAGED);

			expect(harness.decisions.map((decision) => decision.examples.map((example) => example.text))).toEqual([
				Array.from({ length: 20 }, (_, index) => `Choice ${index + 1}`),
			]);
		});

		it("announces the decision last, with every verdict, the engine, model, version and tokens", async () => {
			const harness = makeHarness({});

			await harness.run(TRIAGED);

			expect(harness.published.map((entry) => entry.detailType)).toEqual([
				"FileArticleIntoReadlistCommand",
				"EmailLinksFiltered",
			]);
			expect(harness.published.at(-1)?.detail).toEqual({
				userId: USER,
				receivedAtMessageId: RAM,
				readlist: "a1b2c3d4",
				readlistLabel: "Work",
				decision: "filtered",
				fit: [
					{ ordinal: "0000", verdict: "keep", reason: "Shipping small changes." },
					{ ordinal: "0002", verdict: "drop", reason: "A product sale, not engineering practice." },
					{ ordinal: "0005", verdict: "unsure", reason: "Could be about testing or a vendor pitch." },
				],
				purposeVersion: PURPOSE_VERSION,
				engine: "deepseek-flash",
				model: "deepseek-chat",
				inputTokens: 900,
				outputTokens: 4000,
				reasoningTokens: 3500,
			});
		});

		it("writes one decided line per call and one unsure line per unsure link, neither with a URL or anchor text", async () => {
			const harness = makeHarness({
				decideReadlistFit: async () => ({
					...(await oneOfEachVerdict({
						purpose: { keep: PURPOSE, version: PURPOSE_VERSION },
						examples: [],
						candidates: [],
					})),
					usage: {
						inputTokens: 900,
						outputTokens: 4000,
						reasoningTokens: 3500,
						cacheHitInputTokens: 800,
						cacheMissInputTokens: 100,
					},
				}),
			});

			await harness.run(TRIAGED);

			expect(harness.decidedLines).toEqual([
				{
					level: "INFO",
					event: "readlist-fit-decided",
					userId: USER,
					readlist: "a1b2c3d4",
					receivedAtMessageId: RAM,
					engine: "deepseek-flash",
					model: "deepseek-chat",
					purposeVersion: PURPOSE_VERSION,
					links: 3,
					kept: 1,
					dropped: 1,
					unsure: 1,
					inputTokens: 900,
					outputTokens: 4000,
					reasoningTokens: 3500,
					cacheHitInputTokens: 800,
					cacheMissInputTokens: 100,
					latencyMs: 250,
				},
			]);
			expect(harness.unsureLines).toEqual([
				{
					level: "ERROR",
					event: "readlist-fit-unsure",
					userId: USER,
					readlist: "a1b2c3d4",
					receivedAtMessageId: RAM,
					ordinal: "0005",
					reason: "Could be about testing or a vendor pitch.",
					engine: "deepseek-flash",
					purposeVersion: PURPOSE_VERSION,
				},
			]);
			const written = JSON.stringify([harness.decidedLines, harness.unsureLines]);
			for (const link of TRIAGED.links) {
				expect(written).not.toContain(link.url);
				expect(written).not.toContain(link.anchorText);
			}
		});

		it("omits the cache fields from the decided line when the usage has none", async () => {
			const harness = makeHarness({});

			await harness.run(TRIAGED);

			const [line] = JSON.parse(JSON.stringify(harness.decidedLines));
			expect(line).not.toHaveProperty("cacheHitInputTokens");
			expect(line).not.toHaveProperty("cacheMissInputTokens");
		});

		it("files nothing and still announces the decision when nothing fits", async () => {
			const harness = makeHarness({
				decideReadlistFit: async (input) =>
					fitResult(input.candidates.map(({ id }) => ({ id, verdict: "drop", reason: "Off topic." }))),
			});

			await harness.run(TRIAGED);

			expect(harness.published.map((entry) => entry.detailType)).toEqual(["EmailLinksFiltered"]);
		});

		it("fails the record when the judge keeps an ordinal the email does not hold", async () => {
			const harness = makeHarness({
				decideReadlistFit: async () => fitResult([{ id: "0009", verdict: "keep", reason: "Invented." }]),
			});

			const result = await harness.run(TRIAGED);

			assert(result);
			expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
			expect(harness.published).toEqual([]);
		});

		it("fails the record when the judge fails, so the queue retries it and nothing is announced or logged as decided", async () => {
			const harness = makeHarness({
				decideReadlistFit: async () => {
					throw new Error("the model answered with broken JSON");
				},
			});

			const result = await harness.run(TRIAGED);

			assert(result);
			expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
			expect(harness.published).toEqual([]);
			expect(harness.decidedLines).toEqual([]);
			expect(harness.unsureLines).toEqual([]);
			expect(harness.callFailedLines).toEqual([]);
		});

		it("writes one deepseek-call-failed line with no URL when the provider refuses the call", async () => {
			const harness = makeHarness({
				decideReadlistFit: async () => {
					throw Object.assign(new Error("402 Insufficient Balance"), {
						status: 402,
						code: "invalid_request_error",
						requestID: null,
					});
				},
			});

			const result = await harness.run(TRIAGED);

			assert(result);
			expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
			expect(harness.callFailedLines).toEqual([
				expect.objectContaining({
					level: "ERROR",
					event: "deepseek-call-failed",
					feature: "filter-email-links",
					status: 402,
					userId: USER,
					receivedAtMessageId: RAM,
					readlist: "a1b2c3d4",
					receiveCount: 1,
					messageId: "rec-1",
				}),
			]);
			expect(harness.callFailedLines[0]).not.toHaveProperty("url");
			expect(harness.decidedLines).toEqual([]);
		});

		it("fails the record without announcing when a filing command cannot be published", async () => {
			const published: string[] = [];
			const harness = makeHarness({
				publishEvent: async (event) => {
					if (event.detailType === "FileArticleIntoReadlistCommand") throw new Error("event bus unavailable");
					published.push(event.detailType);
				},
			});

			const result = await harness.run(TRIAGED);

			assert(result);
			expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
			expect(published).toEqual([]);
		});
	});

	it("files every link in the no-purpose form without asking the model when the readlist has no purpose", async () => {
		const harness = makeHarness({ definitions: [workDefinition(undefined)] });

		await harness.run(TRIAGED);

		expect(harness.decisions).toEqual([]);
		expect(harness.overrideReads).toEqual([{ userId: USER, readlist: WORK }]);
		expect(submissions(harness.published)).toEqual([]);
		expect(filings(harness.published)).toEqual(
			TRIAGED.links.map((link) => ({
				url: link.url,
				userId: USER,
				readlist: "a1b2c3d4",
				provenance: EMAIL_PROVENANCE,
				fit: { kind: "no-purpose", source: { kind: "email", receivedAtMessageId: RAM, ordinal: link.ordinal } },
			})),
		);
		expect(harness.published.at(-1)?.detail).toEqual({
			userId: USER,
			receivedAtMessageId: RAM,
			readlist: "a1b2c3d4",
			readlistLabel: "Work",
			decision: "no-purpose",
			fit: [],
			inputTokens: 0,
			outputTokens: 0,
			reasoningTokens: 0,
		});
		expect(harness.decidedLines).toEqual([]);
		expect(harness.unsureLines).toEqual([]);
	});

	it("submits and files nothing when the routed readlist no longer exists, since every link is already in All", async () => {
		const harness = makeHarness({ definitions: [] });

		await harness.run(TRIAGED);

		expect(harness.decisions).toEqual([]);
		expect(harness.overrideReads).toEqual([]);
		expect(harness.published).toEqual([
			{
				detailType: "EmailLinksFiltered",
				detail: {
					userId: USER,
					receivedAtMessageId: RAM,
					readlist: "a1b2c3d4",
					readlistLabel: "All",
					decision: "readlist-missing",
					fit: [],
					inputTokens: 0,
					outputTokens: 0,
					reasoningTokens: 0,
				},
			},
		]);
		expect(harness.decidedLines).toEqual([]);
		expect(harness.unsureLines).toEqual([]);
	});

	it("fails a triage aimed at All, which is never filtered", async () => {
		const harness = makeHarness({});

		const result = await harness.run({ ...TRIAGED, readlist: "default" });

		assert(result);
		expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
		expect(harness.published).toEqual([]);
	});

	it("settles an empty selection without asking the model or filing links", async () => {
		const harness = makeHarness({});

		const result = await harness.run({ ...TRIAGED, links: [] });

		assert(result);
		expect(result.batchItemFailures).toEqual([]);
		expect(harness.decisions).toEqual([]);
		expect(harness.overrideReads).toEqual([]);
		expect(harness.decidedLines).toEqual([]);
		expect(harness.published).toEqual([{ detailType: "EmailLinksFiltered", detail: {
			userId: USER,
			receivedAtMessageId: RAM,
			readlist: "a1b2c3d4",
			readlistLabel: "Work",
			decision: "filtered",
			fit: [],
			purposeVersion: PURPOSE_VERSION,
			inputTokens: 0,
			outputTokens: 0,
			reasoningTokens: 0,
		} }]);
	});

	describe("the final receive", () => {
		const refusedByProvider = async () => {
			throw Object.assign(new Error("402 Insufficient Balance"), {
				status: 402,
				code: "invalid_request_error",
				requestID: null,
			});
		};

		it("publishes the failed decision, files nothing, writes one call-failed line and still fails the record", async () => {
			const harness = makeHarness({ decideReadlistFit: refusedByProvider, receiveCount: 2 });

			const result = await harness.run(TRIAGED);

			assert(result);
			expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
			expect(harness.published).toEqual([
				{
					detailType: "EmailLinksFilterFailed",
					detail: {
						userId: USER,
						receivedAtMessageId: RAM,
						readlist: "a1b2c3d4",
						reason: "decision-retries-exhausted",
						receiveCount: 2,
					},
				},
			]);
			expect(harness.callFailedLines).toHaveLength(1);
		});

		it("publishes nothing on the first receive", async () => {
			const harness = makeHarness({ decideReadlistFit: refusedByProvider, receiveCount: 1 });

			const result = await harness.run(TRIAGED);

			assert(result);
			expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
			expect(harness.published).toEqual([]);
		});

		it("marks the decision failed for a malformed ordinal, with no call-failed line", async () => {
			const harness = makeHarness({ receiveCount: 2 });

			const result = await harness.run({
				...TRIAGED,
				links: [{ ordinal: "7", url: "https://a.test/x", anchorText: "" }],
			});

			assert(result);
			expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
			expect(harness.published.map((entry) => entry.detailType)).toEqual(["EmailLinksFilterFailed"]);
			expect(harness.callFailedLines).toEqual([]);
		});

		it("publishes nothing when the record names no email", async () => {
			const harness = makeHarness({ receiveCount: 2 });
			const { receivedAtMessageId: _receivedAtMessageId, ...withoutEmail } = TRIAGED;

			const result = await harness.run(withoutEmail);

			assert(result);
			expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
			expect(harness.published).toEqual([]);
		});

		it("publishes nothing when the body is not JSON", async () => {
			const harness = makeHarness({ receiveCount: 2 });

			const result = await harness.runBody("not json");

			assert(result);
			expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
			expect(harness.published).toEqual([]);
		});
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

	describe("a redriven message", () => {
		it("costs no model call and files nothing again once the readlist holds a decision for the email", async () => {
			const harness = makeHarness({ definitions: [workDefinition(undefined)] });
			await harness.run(TRIAGED);
			const publishedAfterFirst = harness.published.length;

			const result = await harness.run(TRIAGED);

			assert(result);
			expect(result.batchItemFailures).toEqual([]);
			expect(harness.published.length).toBe(publishedAfterFirst);
			expect(harness.decisions).toEqual([]);
			expect(harness.logLines).toContainEqual([
				"[filter-email-links] skipped",
				{ receivedAtMessageId: RAM, readlist: WORK, reason: "already-decided" },
			]);
		});

		it("costs no model call when the email no longer selects the readlist", async () => {
			const harness = makeHarness({ meta: null });

			const result = await harness.run(TRIAGED);

			assert(result);
			expect(result.batchItemFailures).toEqual([]);
			expect(harness.published).toEqual([]);
			expect(harness.decisions).toEqual([]);
			expect(harness.logLines).toContainEqual([
				"[filter-email-links] skipped",
				{ receivedAtMessageId: RAM, readlist: WORK, reason: "no-longer-selected" },
			]);
		});
	});

	describe("the redrive fence", () => {
		const keepsTwo: DecideReadlistFit = async () =>
			fitResult([
				{ id: "0000", verdict: "keep", reason: "Shipping small changes." },
				{ id: "0002", verdict: "drop", reason: "A product sale, not engineering practice." },
				{ id: "0005", verdict: "keep", reason: "Testing practice." },
			]);

		const thisEmailChoice = (params: { ordinal: string; readerVerdict: "keep" | "drop" }): ReadlistFitOverride => {
			const createdAt = new Date("2026-09-23T09:30:00.000Z");
			const ordinal = EmailLinkOrdinalSchema.parse(params.ordinal);
			return {
				id: readlistFitOverrideId({ createdAt, receivedAtMessageId: RAM, ordinal }),
				url: "https://a.test/small-prs",
				anchorText: "Ship small PRs",
				host: "a.test",
				engineVerdict: params.readerVerdict === "keep" ? "drop" : "keep",
				engineReason: "The judge's earlier call.",
				readerVerdict: params.readerVerdict,
				purposeVersion: PURPOSE_VERSION,
				receivedAtMessageId: RAM,
				ordinal,
				createdAt,
			};
		};

		const lapsed = (): SubscriptionRecord => ({
			userId: UserIdSchema.parse(USER),
			provider: "stripe",
			status: "cancelled",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-09-01T00:00:00.000Z",
		});

		const testingFiling = {
			url: "https://c.test/testing",
			userId: USER,
			readlist: "a1b2c3d4",
			provenance: EMAIL_PROVENANCE,
			fit: {
				verdict: "keep",
				reason: "Testing practice.",
				purposeVersion: PURPOSE_VERSION,
				source: { kind: "email", receivedAtMessageId: RAM, ordinal: "0005" },
			},
		};

		const announcedFit = (published: { detailType: string; detail: unknown }[]) =>
			published
				.filter((entry) => entry.detailType === "EmailLinksFiltered")
				.map((entry) => EmailLinksFilteredEvent.detailSchema.parse(entry.detail).fit);

		it("redrive under an engine keep leaves a link the reader dropped unfiled and stores the engine's verdict", async () => {
			const harness = makeHarness({
				decideReadlistFit: keepsTwo,
				overrides: [thisEmailChoice({ ordinal: "0000", readerVerdict: "drop" })],
			});
			await harness.seedFailedOutcome();

			await harness.run(TRIAGED);

			expect(filings(harness.published)).toEqual([testingFiling]);
			expect(announcedFit(harness.published)).toEqual([
				[
					{ ordinal: "0000", verdict: "keep", reason: "Shipping small changes." },
					{ ordinal: "0002", verdict: "drop", reason: "A product sale, not engineering practice." },
					{ ordinal: "0005", verdict: "keep", reason: "Testing practice." },
				],
			]);
		});

		it("redrive under no purpose files every link except the one the reader dropped", async () => {
			const harness = makeHarness({
				definitions: [workDefinition(undefined)],
				overrides: [thisEmailChoice({ ordinal: "0002", readerVerdict: "drop" })],
			});
			await harness.seedFailedOutcome();

			await harness.run(TRIAGED);

			expect(filings(harness.published)).toEqual(
				["0000", "0005"].map((ordinal) => ({
					url: TRIAGED.links.find((link) => link.ordinal === ordinal)?.url,
					userId: USER,
					readlist: "a1b2c3d4",
					provenance: EMAIL_PROVENANCE,
					fit: { kind: "no-purpose", source: { kind: "email", receivedAtMessageId: RAM, ordinal } },
				})),
			);
		});

		it("a choice recorded during the model call stops that link's filing", async () => {
			const harness = makeHarness({
				overrides: (read) => (read === 1 ? [] : [thisEmailChoice({ ordinal: "0000", readerVerdict: "drop" })]),
			});

			await harness.run(TRIAGED);

			expect(harness.overrideReads).toHaveLength(2);
			expect(filings(harness.published)).toEqual([]);
		});

		it("an override from this email is not sent as an example while other emails' are", async () => {
			const harness = makeHarness({
				overrides: [
					thisEmailChoice({ ordinal: "0002", readerVerdict: "drop" }),
					choice({ minutesAgo: 5, anchorText: "Flaky test triage", host: "d.test", readerVerdict: "keep" }),
				],
			});

			await harness.run(TRIAGED);

			expect(harness.decisions.map((decision) => decision.examples)).toEqual([
				[{ text: "Flaky test triage", host: "d.test", verdict: "keep" }],
			]);
		});

		it("run twice leaves the first outcome and pays one model call", async () => {
			const harness = makeHarness({});
			await harness.run(TRIAGED);
			const firstOutcome = await harness.finalOutcome();

			await harness.run(TRIAGED);

			expect(harness.decisions).toHaveLength(1);
			expect(filings(harness.published)).toHaveLength(1);
			expect(await harness.finalOutcome()).toEqual(firstOutcome);
		});

		it("a failed outcome with full access heals to a decided outcome with filings", async () => {
			const harness = makeHarness({ decideReadlistFit: keepsTwo });
			await harness.seedFailedOutcome();

			await harness.run(TRIAGED);

			expect(filings(harness.published)).toHaveLength(2);
			expect((await harness.finalOutcome())?.map((outcome) => outcome.decision)).toEqual(["filtered"]);
		});

		it("a read-only account gets a failed fact, no model call, no filings, and the record succeeds", async () => {
			const harness = makeHarness({ subscription: lapsed });

			const result = await harness.run(TRIAGED);

			assert(result);
			expect(result.batchItemFailures).toEqual([]);
			expect(harness.decisions).toEqual([]);
			expect(harness.published).toEqual([
				{
					detailType: "EmailLinksFilterFailed",
					detail: {
						userId: USER,
						receivedAtMessageId: RAM,
						readlist: "a1b2c3d4",
						reason: "write-access-lapsed",
						receiveCount: 1,
					},
				},
			]);
		});

		it("run after access lapses on a failed row leaves it failed", async () => {
			const harness = makeHarness({ subscription: lapsed });
			await harness.seedFailedOutcome();

			await harness.run(TRIAGED);

			expect((await harness.finalOutcome())?.map((outcome) => outcome.decision)).toEqual(["failed"]);
		});

		it("a failure publishing the read-only fact fails the record", async () => {
			const harness = makeHarness({
				subscription: lapsed,
				publishFails: (detailType) => detailType === "EmailLinksFilterFailed",
			});

			const result = await harness.run(TRIAGED);

			assert(result);
			expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
		});

		it("access restored before the redrive heals the failed row", async () => {
			let accessLapsed = true;
			const harness = makeHarness({ subscription: () => (accessLapsed ? lapsed() : undefined) });
			await harness.run(TRIAGED);
			accessLapsed = false;

			await harness.run(TRIAGED);

			expect(harness.decisions).toHaveLength(1);
			expect((await harness.finalOutcome())?.map((outcome) => outcome.decision)).toEqual(["filtered"]);
		});

		it("purpose edited after the failure decides under today's purpose", async () => {
			const edited = "Testing practice only.";
			const harness = makeHarness({ definitions: [workDefinition(edited)] });
			await harness.seedFailedOutcome();

			await harness.run(TRIAGED);

			expect(harness.decisions.map((decision) => decision.purpose.version)).toEqual([readlistPurposeVersion(edited)]);
		});

		it("readlist deleted after the failure ends as readlist-missing", async () => {
			const harness = makeHarness({ definitions: [] });
			await harness.seedFailedOutcome();

			await harness.run(TRIAGED);

			expect((await harness.finalOutcome())?.map((outcome) => outcome.decision)).toEqual(["readlist-missing"]);
		});

		it("a store read failure fails the record, and on the final receive publishes the failed fact", async () => {
			const harness = makeHarness({ inboxReadFails: true, receiveCount: 2 });

			const result = await harness.run(TRIAGED);

			assert(result);
			expect(result.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
			expect(harness.published).toEqual([
				{
					detailType: "EmailLinksFilterFailed",
					detail: {
						userId: USER,
						receivedAtMessageId: RAM,
						readlist: "a1b2c3d4",
						reason: "decision-retries-exhausted",
						receiveCount: 2,
					},
				},
			]);
		});

		it("redrive after the reader removed a partially filed link from the readlist page leaves it out", async () => {
			let announcementFails = true;
			const harness = makeHarness({
				decideReadlistFit: keepsTwo,
				time: new Date(Date.now() - 2_000).toISOString(),
				publishFails: (detailType) => detailType === "EmailLinksFiltered" && announcementFails,
			});
			const firstRun = await harness.run(TRIAGED);
			assert(firstRun);
			expect(firstRun.batchItemFailures).toEqual([{ itemIdentifier: "rec-1" }]);
			expect(filings(harness.published)).toHaveLength(2);
			announcementFails = false;
			await harness.saveToAll("https://a.test/small-prs");
			await harness.store.deleteReadlistArticleByUrl({
				userId: UserIdSchema.parse(USER),
				readlist: WORK,
				url: "https://a.test/small-prs",
			});
			const publishedBeforeRedrive = harness.published.length;

			await harness.run(TRIAGED);

			const redrive = harness.published.slice(publishedBeforeRedrive);
			expect(filings(redrive)).toEqual([testingFiling]);
			expect(announcedFit(redrive)).toEqual([
				[
					{ ordinal: "0000", verdict: "keep", reason: "Shipping small changes." },
					{ ordinal: "0002", verdict: "drop", reason: "A product sale, not engineering practice." },
					{ ordinal: "0005", verdict: "keep", reason: "Testing practice." },
				],
			]);
			expect(harness.logLines).toContainEqual([
				"[filter-email-links] filing withheld",
				{ userId: USER, readlist: WORK, receivedAtMessageId: RAM, ordinal: "0000", reason: "removed-after-triage" },
			]);
			expect((await harness.finalOutcome())?.map((outcome) => outcome.decision)).toEqual(["filtered"]);
		});
	});
});
