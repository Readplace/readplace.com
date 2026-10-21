import { toAmazonProductUrl } from "./amazon-product-url";

const BARE = "https://www.amazon.com.au/dp/1492043451";

describe("toAmazonProductUrl", () => {
	it.each([
		["/dp/<ASIN>", "https://www.amazon.com.au/dp/1492043451?ref_=mr_direct_us_au_au&showmri"],
		["/<title>/dp/<ASIN>", "https://www.amazon.com.au/Fundamentals-Software-Architecture-Neal-Ford/dp/1492043451"],
		["/gp/product/<ASIN>", "https://www.amazon.com.au/gp/product/1492043451"],
	])("rewrites the %s form to the bare product link", (_form, url) => {
		expect(toAmazonProductUrl(url)).toBe(BARE);
	});

	it.each([
		"www.amazon.ae",
		"www.amazon.ca",
		"www.amazon.co.jp",
		"www.amazon.co.uk",
		"www.amazon.com",
		"www.amazon.com.au",
		"www.amazon.com.be",
		"www.amazon.com.br",
		"www.amazon.com.mx",
		"www.amazon.com.tr",
		"www.amazon.de",
		"www.amazon.eg",
		"www.amazon.es",
		"www.amazon.fr",
		"www.amazon.ie",
		"www.amazon.in",
		"www.amazon.it",
		"www.amazon.nl",
		"www.amazon.pl",
		"www.amazon.sa",
		"www.amazon.se",
		"www.amazon.sg",
	])("rewrites a title link on %s to that store's bare link", (host) => {
		expect(toAmazonProductUrl(`https://${host}/Fundamentals-Software-Architecture-Neal-Ford/dp/1492043451`)).toBe(
			`https://${host}/dp/1492043451`,
		);
	});

	it("drops the query and the fragment", () => {
		expect(toAmazonProductUrl("https://www.amazon.com.au/dp/1492043451?th=1&psc=1&language=en_GB#reviews")).toBe(BARE);
	});

	it("rewrites an http link to https", () => {
		expect(toAmazonProductUrl("http://www.amazon.com.au/dp/1492043451")).toBe(BARE);
	});

	it("rewrites a host spelled in capitals", () => {
		expect(toAmazonProductUrl("https://WWW.AMAZON.COM.AU/dp/1492043451")).toBe(BARE);
	});

	it("rewrites a link that spells out the https default port", () => {
		expect(toAmazonProductUrl("https://www.amazon.com.au:443/dp/1492043451")).toBe(BARE);
	});

	it("rewrites a link whose title segment is percent-encoded", () => {
		expect(toAmazonProductUrl("https://www.amazon.co.jp/%E3%82%BD%E3%83%95%E3%83%88%E3%82%A6%E3%82%A7%E3%82%A2/dp/1492043451")).toBe(
			"https://www.amazon.co.jp/dp/1492043451",
		);
	});

	it("returns a bare link unchanged", () => {
		expect(toAmazonProductUrl(BARE)).toBe(BARE);
	});

	it("is idempotent", () => {
		const once = toAmazonProductUrl("https://www.amazon.com.au/Fundamentals-Software-Architecture-Neal-Ford/dp/1492043451?th=1");
		expect(toAmazonProductUrl(once)).toBe(once);
	});

	it.each([
		["a non-default port", "https://www.amazon.com.au:8443/dp/1492043451"],
		["http on the https port", "http://www.amazon.com.au:443/dp/1492043451"],
		["a username", "https://reader@www.amazon.com.au/dp/1492043451"],
		["a username and password", "https://reader:secret@www.amazon.com.au/dp/1492043451"],
		["a non-http scheme", "ftp://www.amazon.com.au/dp/1492043451"],
		["unparseable text", "not a url"],
		["an empty string", ""],
		["a store host without www", "https://amazon.com.au/dp/1492043451"],
		["the mobile host", "https://m.amazon.com/dp/1492043451"],
		["the smile host", "https://smile.amazon.com/dp/1492043451"],
		["a store outside the list", "https://www.amazon.co.za/dp/1492043451"],
		["a look-alike suffix host", "https://www.amazon.com.au.example.com/dp/1492043451"],
		["a trailing-dot host", "https://www.amazon.com.au./dp/1492043451"],
		["a 9-character ASIN", "https://www.amazon.com.au/dp/149204345"],
		["an 11-character ASIN", "https://www.amazon.com.au/dp/14920434511"],
		["a lower-case ASIN", "https://www.amazon.com/dp/b0g4pvr3xj"],
		["a language prefix", "https://www.amazon.de/-/en/dp/1492043451"],
		["the /gp/aw/d/ form", "https://www.amazon.com.au/gp/aw/d/1492043451"],
		["a title before /gp/product/", "https://www.amazon.com.au/Fundamentals/gp/product/1492043451"],
		["a review page", "https://www.amazon.com.au/product-reviews/1492043451"],
		["two leading segments", "https://www.amazon.com.au/books/Fundamentals/dp/1492043451"],
		["a search page", "https://www.amazon.com.au/s?k=echo+dot"],
		["a trailing slash after the ASIN", "https://www.amazon.com.au/dp/1492043451/"],
		["a ref segment after the ASIN", "https://www.amazon.com.au/dp/1492043451/ref=sr_1_1"],
		[
			"a search-result link",
			"https://www.amazon.com.au/Fundamentals-Software-Architecture-Neal-Ford/dp/1492043451/ref=sr_1_5?qid=1&sr=8-5",
		],
		[
			"a recommendation link",
			"https://www.amazon.com.au/Fundamentals-Software-Architecture-Neal-Ford/dp/1492043451/ref=pd_bxgy_d_sccl_1/356-2416645-6068311",
		],
		["a ref segment after a /gp/product/ ASIN", "https://www.amazon.com.au/gp/product/1492043451/ref=ox_sc_act_title_1"],
	])("returns %s unchanged", (_label, url) => {
		expect(toAmazonProductUrl(url)).toBe(url);
	});
});
