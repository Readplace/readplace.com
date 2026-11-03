import { siteOfHost } from "./render-site";

describe("siteOfHost", () => {
	it.each([
		{ label: "two subdomains of one co.uk registrable domain", first: "www.example.co.uk", second: "static.example.co.uk", sameSite: true },
		{ label: "two unrelated co.uk names", first: "example.co.uk", second: "attacker.co.uk", sameSite: false },
		{ label: "two tenants of a private suffix", first: "alice.github.io", second: "bob.github.io", sameSite: false },
		{ label: "a publication and its CDN on another registrable domain", first: "news.substack.com", second: "substackcdn.com", sameSite: false },
		{ label: "an attacker suffix of the article's domain", first: "example.com", second: "example.com.attacker.test", sameSite: false },
		{ label: "case and a trailing dot", first: "WWW.Example.com.", second: "cdn.example.com", sameSite: true },
		{ label: "the same public IP literal", first: "203.0.113.10", second: "203.0.113.10", sameSite: true },
		{ label: "neighbouring public IP literals", first: "203.0.113.10", second: "203.0.113.11", sameSite: false },
		{ label: "two hosts without a registrable domain", first: "localhost", second: "intranet", sameSite: false },
	])("answers $sameSite for $label", ({ first, second, sameSite }) => {
		expect(siteOfHost(first) === siteOfHost(second)).toBe(sameSite);
	});

	it("names a punycode IDN host by its registrable domain", () => {
		expect(siteOfHost(new URL("https://www.bücher.example/").hostname)).toBe("xn--bcher-kva.example");
	});

	it("names a host without a registrable domain by the host itself", () => {
		expect(siteOfHost("[2001:db8::12]")).toBe("[2001:db8::12]");
	});
});
