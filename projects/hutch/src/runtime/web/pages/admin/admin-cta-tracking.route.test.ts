import request from "supertest";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { type NewsletterCatalogRecord, type NewsletterStatus, NewsletterNameSchema } from "@packages/domain/newsletter-catalog";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { initInMemoryNewsletterCatalog } from "@packages/test-fixtures/providers/newsletter-catalog";
import { describeUntrackedCtas, findUntrackedCtas } from "@packages/web-test-harness";
import { BROWSER_REQUEST_HEADERS, useTestServer } from "../../../test-app";

const ADMIN_EMAIL = "ops@readplace.com";
const ADMIN_PASSWORD = "password123";
const STATUSES: NewsletterStatus[] = ["pending", "approved", "rejected"];

const useApp = useTestServer();

function catalogRecord(index: number): NewsletterCatalogRecord {
	const at = new Date(Date.parse("2026-09-01T00:00:00.000Z") + index * 60_000).toISOString();
	return {
		from: ForwardableSenderSchema.parse(`issue${index}@letters.example`),
		name: index % 2 === 0 ? NewsletterNameSchema.parse(`Letter ${index}`) : undefined,
		status: index < 60 ? "pending" : STATUSES[index % STATUSES.length],
		evidence: [
			{
				kind: "seed",
				url: "https://letters.example/whitelist",
				note: "Publisher whitelist page",
				addedAt: at,
			},
		],
		replacedBy: index === 62 ? ForwardableSenderSchema.parse("issue0@letters.example") : undefined,
		createdAt: at,
		updatedAt: at,
		reviewedAt: undefined,
	};
}

const ADMIN_PATHS = [
	"/admin",
	"/admin/newsletters",
	"/admin/newsletters?list_status=pending&page=2",
	"/admin/newsletters?list_status=approved",
	"/admin/newsletters?list_status=rejected",
	"/admin/newsletters?list_status=all",
	"/admin/newsletters?list_status=all&q=letter&notice=approved",
	"/admin/newsletters?new=1",
	"/admin/newsletters?edit=issue2%40letters.example",
	"/admin/newsletters?correct=issue2%40letters.example",
	"/admin/recrawl",
	"/admin/extend-trial",
];

describe("every same-origin CTA on the admin surfaces carries its own utm_source", () => {
	it("holds across the admin index, every newsletter catalog state and every failed submission", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const catalog = initInMemoryNewsletterCatalog({
			version: 1,
			records: Array.from({ length: 66 }, (_, index) => catalogRecord(index)),
		});
		const harness = useApp({
			...fixture,
			admin: {
				adminEmails: [ADMIN_EMAIL],
				recrawlServiceToken: fixture.admin.recrawlServiceToken,
			},
			newsletterCatalog: {
				readNewsletterCatalog: catalog.readCatalog,
				writeNewsletterCatalog: catalog.writeCatalog,
				newsletterCatalogSeed: fixture.newsletterCatalog.newsletterCatalogSeed,
			},
		});
		await harness.auth.createUser({
			email: ADMIN_EMAIL,
			password: ADMIN_PASSWORD,
		});
		const agent = request.agent(harness.server);
		await agent.post("/login").type("form").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

		const statuses: number[] = [];
		const untracked: string[] = [];
		for (const path of ADMIN_PATHS) {
			const response = await agent.get(path).set(BROWSER_REQUEST_HEADERS);
			statuses.push(response.status);
			untracked.push(...describeUntrackedCtas(findUntrackedCtas(response.text, { skipSelectors: [], ownOrigin: TEST_APP_ORIGIN })).map((line) => `${path}  ${line}`));
		}

		const failedRenders = [
			{
				label: "create 422",
				response: await agent.post("/admin/newsletters/records/create").set(BROWSER_REQUEST_HEADERS).type("form").send({
					from: "not an address",
					name: "",
					evidence_url: "",
					evidence_note: "",
				}),
			},
			{
				label: "update 409",
				response: await agent.post("/admin/newsletters/records/update").set(BROWSER_REQUEST_HEADERS).type("form").send({
					from: "issue2@letters.example",
					updated_at: "2020-01-01T00:00:00.000Z",
					name: "Letter",
					evidence_url: "",
					evidence_note: "",
				}),
			},
		];
		catalog.failReads(true);
		failedRenders.push({
			label: "read 503",
			response: await agent.get("/admin/newsletters").set(BROWSER_REQUEST_HEADERS),
		});
		for (const { label, response } of failedRenders) {
			statuses.push(response.status);
			untracked.push(...describeUntrackedCtas(findUntrackedCtas(response.text, { skipSelectors: [], ownOrigin: TEST_APP_ORIGIN })).map((line) => `${label}  ${line}`));
		}

		expect(statuses).toEqual([...ADMIN_PATHS.map(() => 200), 422, 409, 503]);
		expect(untracked).toEqual([]);
	});
});
