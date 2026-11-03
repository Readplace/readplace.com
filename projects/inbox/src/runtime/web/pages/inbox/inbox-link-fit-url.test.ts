import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { buildInboxLinkFitUrl } from "./inbox-link-fit-url";

const EMAIL_ID = "2026-06-24T09:00:00.000Z#<m@x>";
const ENCODED_EMAIL_ID = "2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E";

describe("buildInboxLinkFitUrl", () => {
	it("percent-encodes the email id into the fit path", () => {
		expect(
			buildInboxLinkFitUrl({
				emailId: EMAIL_ID,
				ordinal: "0007",
				pageState: { tab: "view" },
			}),
		).toBe(`/inbox/${ENCODED_EMAIL_ID}/links/0007/fit`);
	});

	it("carries the page state on the query string", () => {
		expect(
			buildInboxLinkFitUrl({
				emailId: EMAIL_ID,
				ordinal: "0007",
				pageState: {
					tab: "articles",
					shown: 40,
					filter: { readlist: ReadlistSlugSchema.parse("work"), show: "rest" },
				},
			}),
		).toBe(
			`/inbox/${ENCODED_EMAIL_ID}/links/0007/fit?tab=articles&shown=40&readlist=work&show=rest`,
		);
	});
});
