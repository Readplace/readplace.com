import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import request from "supertest";
import { createDefaultTestAppFixture, TEST_APP_ORIGIN } from "@packages/test-fixtures";
import { BROWSER_REQUEST_HEADERS, useTestServer } from "../../../test-app";
import { PRICE_STATEMENT, SAVES_STAY_STATEMENT } from "../../price-statement";

const useArmB = useTestServer({ drawRandomByte: () => 0 });
const useArmC = useTestServer({ drawRandomByte: () => 255 });

function cookiesFrom(response: { headers: Record<string, string | string[] | undefined> }): string[] {
	const raw = response.headers["set-cookie"];
	if (!raw) return [];
	return Array.isArray(raw) ? raw : [raw];
}

describe("homepage split assignment", () => {
	it("renders and measures arm C on the first request without a redirect", async () => {
		const harness = useArmC(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/").set(BROWSER_REQUEST_HEADERS);
		const { document } = parseHTML(response.text);

		expect(response.status).toBe(200);
		expect(Array.from(document.body.classList).filter((name) => name === "page-home" || name.startsWith("variant-")))
			.toEqual(["page-home", "variant-c"]);
		expect(response.headers["cache-control"]).toBe("private, no-cache");
		const cookies = cookiesFrom(response);
		const assignment = cookies.find((cookie) => cookie.startsWith("hutch_exp="));
		assert(assignment);
		expect(assignment.split(";")[0]).toBe("hutch_exp=homepage-ai-cost%3A2%3Avariant-f");
		expect(harness.analytics.events).toContainEqual(expect.objectContaining({
			event: "pageview",
			path: "/",
			experiment: "homepage-ai-cost-e2",
			experiment_variant: "variant-f",
		}));
	});

	it("states the same price on arm B, in its comparison and its pricing section", async () => {
		const harness = useArmB(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/").set(BROWSER_REQUEST_HEADERS);
		const { document } = parseHTML(response.text);

		expect(document.querySelector(".home-compare__reassurance")?.textContent).toBe(
			`${PRICE_STATEMENT} ${SAVES_STAY_STATEMENT}`,
		);
		expect(document.querySelector('[data-test-section="compare"] h2')?.textContent).toBe(
			"Your reading list for $5 a month, billed yearly — not $200 a month.",
		);
		expect(Array.from(document.querySelectorAll("[data-test-plan]"), (plan) => plan.getAttribute("data-test-plan")))
			.toEqual(["monthly", "yearly"]);
		const saves = document.querySelector('[data-test-section="pricing"] [data-test-saves-stay]');
		assert(saves, "arm B's pricing section must say what happens to saves");
		expect(saves.textContent).toBe(SAVES_STAY_STATEMENT);
		expect(saves.previousElementSibling?.textContent).toBe(PRICE_STATEMENT);
	});

	it("keeps a returning visitor in arm C when a fresh draw would select arm B", async () => {
		const harness = useArmB(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/").set(BROWSER_REQUEST_HEADERS)
			.set("Cookie", "hutch_exp=homepage-ai-cost%3A2%3Avariant-f");
		const { document } = parseHTML(response.text);

		expect(response.status).toBe(200);
		expect(Array.from(document.body.classList).filter((name) => name === "page-home" || name.startsWith("variant-")))
			.toEqual(["page-home", "variant-c"]);
		expect(harness.analytics.events).toContainEqual(expect.objectContaining({
			experiment_variant: "variant-f",
		}));
	});

	it.each(["homepage-split:3:variant-b", "homepage-ai-cost:0:variant-c", "homepage-ai-cost:1:variant-c", "homepage-ai-cost:1:variant-d"])(
		"reassigns a visitor carrying the retired assignment %s", async (previousAssignment) => {
			const harness = useArmC(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/").set(BROWSER_REQUEST_HEADERS)
				.set("Cookie", `hutch_exp=${encodeURIComponent(previousAssignment)}`);
			const { document } = parseHTML(response.text);

			expect(response.status).toBe(200);
			expect(Array.from(document.body.classList).filter((name) => name === "page-home" || name.startsWith("variant-")))
				.toEqual(["page-home", "variant-c"]);
			expect(harness.analytics.events).toContainEqual(expect.objectContaining({
				experiment: "homepage-ai-cost-e2",
				experiment_variant: "variant-f",
			}));
		},
	);

	it("serves crawlers the control even with an arm C cookie and leaves them unmeasured", async () => {
		const harness = useArmC(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/").set(BROWSER_REQUEST_HEADERS)
			.set("User-Agent", "Googlebot/2.1 (+http://www.google.com/bot.html)")
			.set("Cookie", "hutch_exp=homepage-ai-cost%3A2%3Avariant-f");
		const { document } = parseHTML(response.text);

		expect(response.status).toBe(200);
		expect(Array.from(document.body.classList).filter((name) => name === "page-home" || name.startsWith("variant-")))
			.toEqual(["page-home", "variant-b"]);
		expect(harness.analytics.events).toEqual([]);
		const cookies = cookiesFrom(response);
		expect(cookies.filter((cookie) => cookie.startsWith("hutch_exp="))).toEqual([]);
	});

	it("serves markdown requests the control without assigning or measuring an arm", async () => {
		const harness = useArmC(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/").set(BROWSER_REQUEST_HEADERS)
			.set("Accept", "text/markdown")
			.set("Cookie", "hutch_exp=homepage-ai-cost%3A2%3Avariant-f");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toContain("text/markdown");
		expect(harness.analytics.events.filter((event) => event.event === "pageview").map((event) => ({
			experiment: event.experiment,
			variant: event.experiment_variant,
		}))).toEqual([{ experiment: undefined, variant: undefined }]);
		const cookies = cookiesFrom(response);
		expect(cookies.filter((cookie) => cookie.startsWith("hutch_exp="))).toEqual([]);
	});
});
