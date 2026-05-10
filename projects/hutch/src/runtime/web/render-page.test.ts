import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { UserIdSchema } from "@packages/domain/user";
import type { BannerStateSource } from "./banner-state";
import type { PageBody } from "./page-body.types";
import { renderPage } from "./render-page";

function createTestPageBody(): PageBody {
	return {
		seo: {
			title: "Test Page",
			description: "Test description",
			canonicalUrl: "https://readplace.com/test",
		},
		styles: "",
		content: { html: "<main><p>Test content</p></main>" },
	};
}

const USER_ID = UserIdSchema.parse("user-1");

function createSource(overrides: Partial<BannerStateSource> = {}): BannerStateSource {
	return { ...overrides };
}

describe("renderPage", () => {
	it("should render guest navigation for an unauthenticated request", () => {
		const result = renderPage(createSource(), createTestPageBody()).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const nav = doc.querySelector("[data-test-nav-variant]");
		assert(nav, "nav container must be rendered");
		expect(nav.getAttribute("data-test-nav-variant")).toBe("guest");
	});

	it("should render authenticated navigation for a request with a userId", () => {
		const result = renderPage(
			createSource({ userId: USER_ID, emailVerified: true }),
			createTestPageBody(),
		).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const nav = doc.querySelector("[data-test-nav-variant]");
		assert(nav, "nav container must be rendered");
		expect(nav.getAttribute("data-test-nav-variant")).toBe("authenticated");
	});

	it("should show the verification banner for an authenticated, unverified request", () => {
		const result = renderPage(
			createSource({ userId: USER_ID, emailVerified: false }),
			createTestPageBody(),
		).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const banner = doc.querySelector("[data-test-verify-banner]");
		assert(banner, "verify banner must be rendered");
		expect(banner.classList.contains("verify-banner--visible")).toBe(true);
	});

	it("should hide the verification banner for an authenticated, verified request", () => {
		const result = renderPage(
			createSource({ userId: USER_ID, emailVerified: true }),
			createTestPageBody(),
		).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const banner = doc.querySelector("[data-test-verify-banner]");
		assert(banner, "verify banner must be rendered");
		expect(banner.classList.contains("verify-banner--hidden")).toBe(true);
	});

	it("should hide the verification banner for a request without an emailVerified flag", () => {
		const result = renderPage(
			createSource({ userId: USER_ID }),
			createTestPageBody(),
		).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const banner = doc.querySelector("[data-test-verify-banner]");
		assert(banner, "verify banner must be rendered");
		expect(banner.classList.contains("verify-banner--hidden")).toBe(true);
	});

	it("should hide the verification banner for an unauthenticated request", () => {
		const result = renderPage(createSource(), createTestPageBody()).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const banner = doc.querySelector("[data-test-verify-banner]");
		assert(banner, "verify banner must be rendered");
		expect(banner.classList.contains("verify-banner--hidden")).toBe(true);
	});

	it("renders the Import Links nav item when ?feature=import is set on an authenticated request", () => {
		const result = renderPage(
			createSource({ userId: USER_ID, query: { feature: "import" } }),
			createTestPageBody(),
		).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		const link = doc.querySelector('[data-test-nav-item="import"]');
		assert(link, "Import Links nav item must be rendered when the feature flag is set");
		expect(link.getAttribute("href")).toBe("/import?feature=import");
	});

	it("hides the Import Links nav item when the request has no feature flag", () => {
		const result = renderPage(
			createSource({ userId: USER_ID }),
			createTestPageBody(),
		).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		expect(doc.querySelector('[data-test-nav-item="import"]')).toBeNull();
	});

	it("hides the Import Links nav item when the feature query value is something else", () => {
		const result = renderPage(
			createSource({ userId: USER_ID, query: { feature: "something-else" } }),
			createTestPageBody(),
		).to("text/html");
		const doc = new JSDOM(result.body).window.document;

		expect(doc.querySelector('[data-test-nav-item="import"]')).toBeNull();
	});
});
