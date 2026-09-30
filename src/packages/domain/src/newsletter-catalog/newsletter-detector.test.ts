import assert from "node:assert/strict";
import { ForwardableSenderSchema } from "../gmail/build-forwarding-filter-query";
import { NewsletterFromSchema, NewsletterNameSchema, type NewsletterCatalogDocument } from "./newsletter-catalog.schema";
import {
	type DetectNewsletters,
	initCatalogNewsletterDetector,
	initNewsletterDetectorChain,
} from "./newsletter-detector";

const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const BREW = ForwardableSenderSchema.parse("crew@morningbrew.com");
const SPAM = ForwardableSenderSchema.parse("deals@spam.com");
const AT = "2026-09-30T00:00:00.000Z";

const document: NewsletterCatalogDocument = {
	version: 1,
	records: [
		{ from: TLDR, name: NewsletterNameSchema.parse("TLDR"), status: "approved", evidence: [], createdAt: AT, updatedAt: AT },
		{ from: BREW, status: "pending", evidence: [], createdAt: AT, updatedAt: AT },
		{ from: SPAM, status: "rejected", evidence: [], createdAt: AT, updatedAt: AT },
	],
};

describe("initCatalogNewsletterDetector", () => {
	it("recognises only approved catalog records among the asked senders", async () => {
		const detect = initCatalogNewsletterDetector({ readCatalog: async () => ({ ok: true, document }) });

		const detection = await detect([TLDR, BREW, SPAM]);

		assert.deepEqual(detection, {
			status: "available",
			recognized: new Map([[TLDR, { from: TLDR, name: "TLDR", source: "catalog" }]]),
		});
	});

	it("does not recognise an approved record the caller did not ask about", async () => {
		const detect = initCatalogNewsletterDetector({ readCatalog: async () => ({ ok: true, document }) });

		assert.deepEqual(await detect([BREW]), { status: "available", recognized: new Map() });
	});

	it("recognises every sender at a domain with an approved wildcard, preferring an approved exact record", async () => {
		const mamund = ForwardableSenderSchema.parse("mamund@substack.com");
		const pragmatic = ForwardableSenderSchema.parse("pragmatic@substack.com");
		const subdomain = ForwardableSenderSchema.parse("news@mail.substack.com");
		const detect = initCatalogNewsletterDetector({
			readCatalog: async () => ({
				ok: true,
				document: {
					version: 1,
					records: [
						{ from: NewsletterFromSchema.parse("*@substack.com"), name: NewsletterNameSchema.parse("Substack"), status: "approved", evidence: [], createdAt: AT, updatedAt: AT },
						{ from: pragmatic, name: NewsletterNameSchema.parse("The Pragmatic Engineer"), status: "approved", evidence: [], createdAt: AT, updatedAt: AT },
						{ from: NewsletterFromSchema.parse("*@morningbrew.com"), status: "pending", evidence: [], createdAt: AT, updatedAt: AT },
					],
				},
			}),
		});

		const detection = await detect([mamund, pragmatic, subdomain, BREW]);

		assert.deepEqual(detection, {
			status: "available",
			recognized: new Map([
				[mamund, { from: mamund, name: "Substack", source: "catalog" }],
				[pragmatic, { from: pragmatic, name: "The Pragmatic Engineer", source: "catalog" }],
			]),
		});
	});

	it("reports detection as unavailable when the catalog cannot be read", async () => {
		const detect = initCatalogNewsletterDetector({ readCatalog: async () => ({ ok: false, reason: "unavailable" }) });

		assert.deepEqual(await detect([TLDR]), { status: "unavailable" });
	});
});

describe("initNewsletterDetectorChain", () => {
	it("asks each detector only about senders the earlier detectors left unrecognised", async () => {
		const asked: string[][] = [];
		const recognising =
			(sender: typeof TLDR): DetectNewsletters =>
			async (senders) => {
				asked.push([...senders]);
				return {
					status: "available",
					recognized: new Map([[sender, { from: sender, name: undefined, source: "catalog" }]]),
				};
			};
		const detect = initNewsletterDetectorChain({ detectors: [recognising(TLDR), recognising(BREW)] });

		const detection = await detect([TLDR, BREW, SPAM]);

		assert.deepEqual(asked, [[TLDR, BREW, SPAM], [BREW, SPAM]]);
		assert.deepEqual(detection, {
			status: "available",
			recognized: new Map([
				[TLDR, { from: TLDR, name: undefined, source: "catalog" }],
				[BREW, { from: BREW, name: undefined, source: "catalog" }],
			]),
		});
	});

	it("reports the chain as unavailable when any detector is unavailable", async () => {
		const detect = initNewsletterDetectorChain({
			detectors: [initCatalogNewsletterDetector({ readCatalog: async () => ({ ok: false, reason: "unavailable" }) })],
		});

		assert.deepEqual(await detect([TLDR]), { status: "unavailable" });
	});

	it("recognises nothing when no detector is registered", async () => {
		const detect = initNewsletterDetectorChain({ detectors: [] });

		assert.deepEqual(await detect([TLDR]), { status: "available", recognized: new Map() });
	});
});
