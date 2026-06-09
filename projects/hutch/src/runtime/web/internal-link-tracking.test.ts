import { withInternalTracking } from "./internal-link-tracking";

describe("withInternalTracking", () => {
	it("stamps a root-relative href with the section (utm_source), the element (utm_content), and utm_medium=internal so the click middleware can count it", () => {
		const href = withInternalTracking("/account", { source: "queue", content: "subscribe" });
		const params = new URL(href, "https://internal.invalid").searchParams;
		expect(params.get("utm_source")).toBe("queue");
		expect(params.get("utm_medium")).toBe("internal");
		expect(params.get("utm_content")).toBe("subscribe");
	});

	it("never emits utm_campaign — two dimensions (section, element) answer the click-volume question", () => {
		const href = withInternalTracking("/account", { source: "queue", content: "subscribe" });
		expect(href).not.toContain("utm_campaign");
	});

	it("appends to an href that already has a query string instead of replacing it (filter URLs carry tab/order)", () => {
		const href = withInternalTracking("/queue?tab=read&order=asc", { source: "queue", content: "filter-read" });
		const url = new URL(href, "https://internal.invalid");
		expect(url.searchParams.get("tab")).toBe("read");
		expect(url.searchParams.get("order")).toBe("asc");
		expect(url.searchParams.get("utm_source")).toBe("queue");
	});

	it("preserves a hash fragment after the appended query string", () => {
		const href = withInternalTracking("/queue#latest-saved", { source: "queue", content: "save" });
		expect(href.endsWith("#latest-saved")).toBe(true);
		expect(new URL(href, "https://internal.invalid").searchParams.get("utm_medium")).toBe("internal");
	});

	it("overwrites pre-existing utm params so calling it twice is idempotent rather than duplicating keys", () => {
		const once = withInternalTracking("/account", { source: "nav", content: "account" });
		const twice = withInternalTracking(once, { source: "footer", content: "account" });
		expect(twice).toBe(withInternalTracking("/account", { source: "footer", content: "account" }));
		expect(new URL(twice, "https://internal.invalid").searchParams.getAll("utm_source")).toEqual(["footer"]);
	});

	it("leaves an absolute external URL untouched — tagging it would leak our analytics params to another site and the click is not ours to count", () => {
		const external = "https://github.com/Readplace/readplace.com";
		expect(withInternalTracking(external, { source: "home-hero", content: "github" })).toBe(external);
	});

	it("leaves a protocol-relative URL untouched — it resolves to another origin, so stamping it would both leak our params and strip the host", () => {
		const external = "//cdn.example.com/x?a=1";
		expect(withInternalTracking(external, { source: "home-hero", content: "cdn" })).toBe(external);
	});
});
