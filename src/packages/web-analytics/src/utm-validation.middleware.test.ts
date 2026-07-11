import type { Request, Response } from "express";
import { utmValidationMiddleware } from "./utm-validation.middleware";

interface RunResult {
	status?: number;
	nextCalled: boolean;
}

function run(query: Request["query"]): RunResult {
	let status: number | undefined;
	let nextCalled = false;
	const res: Partial<Response> = {
		status(code: number) {
			status = code;
			return res as Response;
		},
		end() {
			return res as Response;
		},
	};
	const req: Partial<Request> = { query };
	const next = () => {
		nextCalled = true;
	};
	utmValidationMiddleware(req as Request, res as Response, next);
	return { status, nextCalled };
}

function accepts(query: Request["query"]): boolean {
	const result = run(query);
	return result.nextCalled && result.status === undefined;
}

function rejects(query: Request["query"]): boolean {
	const result = run(query);
	return result.status === 400 && !result.nextCalled;
}

describe("utmValidationMiddleware", () => {
	it("passes a request carrying no utm params at all", () => {
		expect(accepts({})).toBe(true);
	});

	it.each([
		"fagnerbrack.com",
		"web-app",
		"share-balloon",
		"beyond-the-demo",
		"02ship.com",
		"chatgpt.com",
		"comingup.io",
		"gh-profile",
		"hn-bio",
		"linkedin",
		"reddit",
		"substack",
		"post-email-title",
		"m",
		"read",
		"877643587",
	])("passes the real inbound utm_source %s seen in production traffic", (utm_source) => {
		expect(accepts({ utm_source })).toBe(true);
	});

	it.each([
		{ utm_source: "header-nav", utm_medium: "internal", utm_content: "queue", utm_term: "mobile_ios" },
		{ utm_source: "web-app", utm_medium: "banner", utm_campaign: "extension-suggestion", utm_content: "cta-button" },
		{ utm_campaign: "homepage-split", utm_medium: "experiment", utm_content: "variant-a" },
		{ utm_source: "read", utm_medium: "share", utm_campaign: "read-permalink" },
		{ utm_source: "auth-page", utm_medium: "internal", utm_content: "google-signup-btn" },
		{ utm_source: "trial-reminder", utm_medium: "email", utm_campaign: "trial-preexpiry" },
	])("passes the links the app builds for itself: %o", (query) => {
		expect(accepts(query)).toBe(true);
	});

	it("passes LinkedIn's underscored utm_medium=member_desktop", () => {
		expect(accepts({ utm_medium: "member_desktop" })).toBe(true);
	});

	it("passes the countdown the public reader stamps on its save button, whose value is built from the hours left", () => {
		expect(accepts({ utm_source: "view-article", utm_medium: "internal", utm_content: "3d_23h_left" })).toBe(true);
	});

	it("passes the device class the queue card stamps on utm_term, so underscore must stay in the charset", () => {
		expect(accepts({ utm_source: "queue-card", utm_medium: "internal", utm_term: "mobile_android" })).toBe(true);
	});

	it("passes the sharer's 6-hex-char id that a share link carries in utm_content — rejecting it would make every shared article expire as if nobody had shared it", () => {
		expect(accepts({ utm_source: "share-balloon", utm_medium: "copy", utm_content: "3f9a2b" })).toBe(true);
	});

	it("passes an empty utm value — every reader already treats it as absent, so rejecting it would 400 a harmless link", () => {
		expect(accepts({ utm_source: "" })).toBe(true);
	});

	it("rejects the bare apostrophe that a scanner appended to utm_source", () => {
		expect(rejects({ utm_source: "'" })).toBe(true);
	});

	it("rejects an apostrophe appended to a value the scanner crawled off our own /install link", () => {
		expect(rejects({ utm_source: "web-app'" })).toBe(true);
	});

	it.each([
		["ascii single quote", "a'b"],
		["ascii double quote", 'a"b'],
		["backtick", "a`b"],
		["left single curly quote", "a‘b"],
		["right single curly quote", "a’b"],
		["left double curly quote", "a“b"],
		["right double curly quote", "a”b"],
	])("rejects a %s — quotes of every kind are what corrupt the analytics group-by", (_label, utm_source) => {
		expect(rejects({ utm_source })).toBe(true);
	});

	it("rejects a decoded ampersand, which would otherwise read as a second param downstream", () => {
		expect(rejects({ utm_source: "a&b" })).toBe(true);
	});

	it.each(["/", "?", "#", "[", "]", "@", ":", ";", "=", "+", "$", ",", "!", "*", "(", ")", "%", "<", ">", "\\", "|", "{", "}", "^"])(
		"rejects the url-restricted character %s",
		(char) => {
			expect(rejects({ utm_source: `a${char}b` })).toBe(true);
		},
	);

	it("rejects whitespace, so a value decoded from %20 or + cannot split a log field", () => {
		expect(rejects({ utm_source: "spring sale" })).toBe(true);
	});

	it("rejects a newline, which could otherwise forge a second line in the JSON log stream", () => {
		expect(rejects({ utm_source: "a\nb" })).toBe(true);
	});

	it("passes a repeated utm param whose values are all well-formed — express parses it to an array, every reader already ignores it, and a link double-tagged by a shortener is not an attack", () => {
		expect(accepts({ utm_source: ["fagnerbrack.com", "reddit"] })).toBe(true);
	});

	it("rejects a repeated utm param when any one of its values carries a quote", () => {
		expect(rejects({ utm_source: ["fagnerbrack.com", "'"] })).toBe(true);
	});

	it.each(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id"])(
		"validates %s — every utm_ param is forwarded into redirects, not just the ones the dashboard reads",
		(name) => {
			expect(rejects({ [name]: "'" })).toBe(true);
		},
	);

	it("matches the utm_ prefix case-insensitively, mirroring the collector that forwards these params", () => {
		expect(rejects({ UTM_Source: "'" })).toBe(true);
	});

	it("leaves non-utm params alone, so a queue search for an apostrophe still reaches its route", () => {
		expect(accepts({ q: "it's" })).toBe(true);
	});

	it("leaves Medium's own source param alone — its post_page----- value is not a utm param", () => {
		expect(accepts({ source: "post_page-----e442ad463473---------------" })).toBe(true);
	});
});
