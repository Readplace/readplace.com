import { articleHostFrom, classifyContentSource, OWN_CONTENT_DOMAINS } from "./content-source";

describe("articleHostFrom", () => {
	it("returns the lowercased hostname so view_opened and view_save_intent normalize identically", () => {
		expect(articleHostFrom("https://EN.Wikipedia.ORG/wiki/Foo?x=1#frag")).toBe("en.wikipedia.org");
	});
});

describe("classifyContentSource", () => {
	it("classifies an own apex domain as own", () => {
		for (const domain of OWN_CONTENT_DOMAINS) {
			expect(classifyContentSource(domain)).toBe("own");
		}
	});

	it("classifies a subdomain of an own domain as own (so www. and blog. count without being listed)", () => {
		expect(classifyContentSource("www.readplace.com")).toBe("own");
		expect(classifyContentSource("blog.fagnerbrack.com")).toBe("own");
	});

	it("classifies a third-party domain as third_party", () => {
		expect(classifyContentSource("en.wikipedia.org")).toBe("third_party");
		expect(classifyContentSource("medium.com")).toBe("third_party");
	});

	it("matches case-insensitively", () => {
		expect(classifyContentSource("FAGNERBRACK.COM")).toBe("own");
	});

	it("does not treat a look-alike suffix as own (readplace.com.evil.example is third-party)", () => {
		expect(classifyContentSource("readplace.com.evil.example")).toBe("third_party");
		expect(classifyContentSource("notreadplace.com")).toBe("third_party");
	});
});
