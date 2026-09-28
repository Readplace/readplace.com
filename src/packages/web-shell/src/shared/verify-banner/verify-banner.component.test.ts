import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { BannerState } from "../../banner-state";
import {
	VERIFICATION_CONTACT_EMAIL,
	renderVerifyBanner,
} from "./verify-banner.component";

function parse(
	state: Pick<BannerState, "isAuthenticated" | "emailVerified" | "verification">,
): Element {
	const doc = new JSDOM(renderVerifyBanner(state)).window.document;
	const banner = doc.querySelector("[data-test-verify-banner]");
	assert(banner, "verify banner must always be rendered");
	return banner;
}

describe("renderVerifyBanner", () => {
	it("renders a hidden, verified banner for a verified user", () => {
		const banner = parse({ isAuthenticated: true, emailVerified: true });
		expect(banner.getAttribute("data-verification-state")).toBe("verified");
		expect(banner.classList.contains("verify-banner--hidden")).toBe(true);
	});

	it("renders a hidden banner for a guest", () => {
		const banner = parse({ isAuthenticated: false, emailVerified: undefined });
		expect(banner.getAttribute("data-verification-state")).toBe("verified");
		expect(banner.classList.contains("verify-banner--hidden")).toBe(true);
	});

	it("renders the generic prompt for an unverified user with no computed status", () => {
		const banner = parse({ isAuthenticated: true, emailVerified: false });
		expect(banner.getAttribute("data-verification-state")).toBe("pending");
		expect(banner.classList.contains("verify-banner--visible")).toBe(true);
		expect(banner.textContent).toBe("Please verify your email. Check your inbox or spam folder.");
	});

	it("roots every state in the shared banner bar", () => {
		const states: Pick<BannerState, "isAuthenticated" | "emailVerified" | "verification">[] = [
			{ isAuthenticated: true, emailVerified: true },
			{ isAuthenticated: true, emailVerified: false },
			{ isAuthenticated: true, emailVerified: false, verification: { state: "counting-down", daysLeft: 3 } },
			{ isAuthenticated: true, emailVerified: false, verification: { state: "locked" } },
		];
		expect(states.map((state) => parse(state).classList.contains("banner-bar"))).toEqual([true, true, true, true]);
	});

	it("renders a plural day countdown before the deadline", () => {
		const banner = parse({
			isAuthenticated: true,
			emailVerified: false,
			verification: { state: "counting-down", daysLeft: 5 },
		});
		expect(banner.getAttribute("data-verification-state")).toBe("counting-down");
		expect(banner.classList.contains("verify-banner--visible")).toBe(true);
		expect(banner.textContent).toBe(
			"Please verify your email within 5 days to keep your account active. Check your inbox or spam folder.",
		);
	});

	it("uses the singular day word on the final day", () => {
		const banner = parse({
			isAuthenticated: true,
			emailVerified: false,
			verification: { state: "counting-down", daysLeft: 1 },
		});
		expect(banner.textContent).toContain("within 1 day to keep your account active");
	});

	it("renders the locked copy with a mailto link to the concierge inbox", () => {
		const banner = parse({
			isAuthenticated: true,
			emailVerified: false,
			verification: { state: "locked" },
		});
		expect(banner.getAttribute("data-verification-state")).toBe("locked");
		expect(banner.classList.contains("verify-banner--visible")).toBe(true);
		const link = banner.querySelector(".verify-banner__contact");
		assert(link, "locked banner must offer a contact link");
		expect(link.getAttribute("href")).toBe(`mailto:${VERIFICATION_CONTACT_EMAIL}`);
		expect(link.textContent).toBe(VERIFICATION_CONTACT_EMAIL);
	});
});
