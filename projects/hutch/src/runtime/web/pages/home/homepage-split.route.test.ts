import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import request from "supertest";
import { createDefaultTestAppFixture, TEST_APP_ORIGIN } from "@packages/test-fixtures";
import { BROWSER_REQUEST_HEADERS, useTestServer } from "../../../test-app";
import { campaignTag, HOMEPAGE_SPLIT } from "../../experiments/homepage-split";

const useArmB = useTestServer({ drawRandomByte: () => 255 });
const useArmA = useTestServer({ drawRandomByte: () => 0 });

function cookiesFrom(response: { headers: Record<string, string | string[] | undefined> }): string[] {
	const raw = response.headers["set-cookie"];
	if (!raw) return [];
	return Array.isArray(raw) ? raw : [raw];
}

describe("homepage split assignment", () => {
	it("renders and measures arm B on the first request without a redirect", async () => {
		const harness = useArmB(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/").set(BROWSER_REQUEST_HEADERS);
		const { document } = parseHTML(response.text);

		expect(response.status).toBe(200);
		expect(Array.from(document.body.classList).filter((name) => name === "page-home" || name.startsWith("variant-")))
			.toEqual(["page-home", "variant-b"]);
		expect(response.headers["cache-control"]).toBe("private, no-cache");
		const cookies = cookiesFrom(response);
		const assignment = cookies.find((cookie) => cookie.startsWith("hutch_exp="));
		assert(assignment);
		expect(assignment.split(";")[0]).toBe("hutch_exp=homepage-ai-cost%3A1%3Avariant-d");
		expect(harness.analytics.events).toContainEqual(expect.objectContaining({
			event: "pageview",
			path: "/",
			experiment: campaignTag(HOMEPAGE_SPLIT),
			experiment_variant: "variant-d",
		}));
	});

	it("keeps a returning visitor in arm B when a fresh draw would select arm A", async () => {
		const harness = useArmA(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/").set(BROWSER_REQUEST_HEADERS)
			.set("Cookie", "hutch_exp=homepage-ai-cost%3A1%3Avariant-d");
		const { document } = parseHTML(response.text);

		expect(response.status).toBe(200);
		expect(Array.from(document.body.classList).filter((name) => name === "page-home" || name.startsWith("variant-")))
			.toEqual(["page-home", "variant-b"]);
		expect(harness.analytics.events).toContainEqual(expect.objectContaining({
			experiment_variant: "variant-d",
		}));
	});

	it.each(["homepage-split:3:variant-b", "homepage-ai-cost:0:variant-c"])(
		"reassigns a visitor carrying the retired assignment %s", async (previousAssignment) => {
			const harness = useArmB(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/").set(BROWSER_REQUEST_HEADERS)
				.set("Cookie", `hutch_exp=${encodeURIComponent(previousAssignment)}`);
			const { document } = parseHTML(response.text);

			expect(response.status).toBe(200);
			expect(Array.from(document.body.classList).filter((name) => name === "page-home" || name.startsWith("variant-")))
				.toEqual(["page-home", "variant-b"]);
			expect(harness.analytics.events).toContainEqual(expect.objectContaining({
				experiment: "homepage-ai-cost-e1",
				experiment_variant: "variant-d",
			}));
		},
	);

	it("serves crawlers the control even with an arm B cookie and leaves them unmeasured", async () => {
		const harness = useArmB(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/").set(BROWSER_REQUEST_HEADERS)
			.set("User-Agent", "Googlebot/2.1 (+http://www.google.com/bot.html)")
			.set("Cookie", "hutch_exp=homepage-ai-cost%3A1%3Avariant-d");
		const { document } = parseHTML(response.text);

		expect(response.status).toBe(200);
		expect(Array.from(document.body.classList).filter((name) => name === "page-home" || name.startsWith("variant-")))
			.toEqual(["page-home", "variant-a"]);
		expect(harness.analytics.events).toEqual([]);
		const cookies = cookiesFrom(response);
		expect(cookies.filter((cookie) => cookie.startsWith("hutch_exp="))).toEqual([]);
	});

	it("serves markdown requests the control without assigning or measuring an arm", async () => {
		const harness = useArmB(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/").set(BROWSER_REQUEST_HEADERS)
			.set("Accept", "text/markdown")
			.set("Cookie", "hutch_exp=homepage-ai-cost%3A1%3Avariant-d");

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
