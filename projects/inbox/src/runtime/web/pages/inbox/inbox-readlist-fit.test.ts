import { EmailLinkOrdinalSchema, type InboxEmailLinksMeta } from "@packages/domain/inbox";
import { ReadlistFitOverrideIdSchema, ReadlistSlugSchema } from "@packages/domain/readlist";
import type { ReadlistFitOverride } from "@packages/provider-contracts/article-store";
import { cardReadlistFits } from "./inbox-readlist-fit";

const EMAIL_ID = "2026-06-24T09:00:00.000Z#<m@x>";
const ORDINAL = EmailLinkOrdinalSchema.parse("0001");
const WORK = ReadlistSlugSchema.parse("work");
const SCIENCE = ReadlistSlugSchema.parse("science");

const workOutcome = {
	readlist: WORK,
	readlistLabel: "Work",
	decision: "filtered" as const,
	fit: [{ ordinal: ORDINAL, verdict: "keep" as const, reason: "Fits." }],
};

const workOverride: ReadlistFitOverride = {
	id: ReadlistFitOverrideIdSchema.parse(`0000000000000001-${EMAIL_ID}-0001`),
	url: "https://example.com/post",
	anchorText: "Post",
	host: "example.com",
	readerVerdict: "drop",
	receivedAtMessageId: EMAIL_ID,
	ordinal: ORDINAL,
	createdAt: new Date("2026-10-14T10:00:00.000Z"),
};

function meta(overrides: Partial<InboxEmailLinksMeta> = {}): InboxEmailLinksMeta {
	return {
		truncated: false,
		extractionFailed: false,
		selectedReadlists: [
			{ readlist: WORK, label: "Work" },
			{ readlist: SCIENCE, label: "Science" },
		],
		readlistOutcomes: [workOutcome],
		...overrides,
	};
}

describe("cardReadlistFits", () => {
	it("gives one entry per routed readlist with an outcome, with the card's current override", () => {
		const fits = cardReadlistFits({
			meta: meta(),
			fitOverrides: new Map([[WORK, [workOverride]]]),
			emailId: EMAIL_ID,
			ordinal: ORDINAL,
		});

		expect(fits).toEqual([{ readlist: WORK, label: "Work", outcome: workOutcome, override: workOverride }]);
	});

	it("gives no override when the readlist has none listed", () => {
		const fits = cardReadlistFits({ meta: meta(), fitOverrides: new Map(), emailId: EMAIL_ID, ordinal: ORDINAL });

		expect(fits.map((fit) => fit.override)).toEqual([undefined]);
	});

	it("gives nothing while saves are held", () => {
		expect(
			cardReadlistFits({ meta: meta({ savesHeld: true }), fitOverrides: new Map(), emailId: EMAIL_ID, ordinal: ORDINAL }),
		).toEqual([]);
	});

	it("gives nothing before extraction has written its meta", () => {
		expect(cardReadlistFits({ meta: undefined, fitOverrides: new Map(), emailId: EMAIL_ID, ordinal: ORDINAL })).toEqual([]);
	});

	it("gives nothing for routed readlists still deciding", () => {
		expect(
			cardReadlistFits({
				meta: meta({ readlistOutcomes: undefined }),
				fitOverrides: new Map(),
				emailId: EMAIL_ID,
				ordinal: ORDINAL,
			}),
		).toEqual([]);
	});
});
