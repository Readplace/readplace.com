import { readabilityAdditions } from "./readability-additions";
import { initReadabilityParser } from "./readability-parser";
import { restoreRetaggedTables } from "./restore-retagged-tables";

describe("restoreRetaggedTables", () => {
	it("wraps the rows of a <tbody> that Readability retagged to <div> back into a table", () => {
		const retaggedTbody =
			"<div>\n<tr><td>1d-interleaved-parityfec</td><td>application/1d-interleaved-parityfec</td></tr>\n<tr><td>3gpdash-qoe-report+xml</td><td>application/3gpdash-qoe-report+xml</td></tr>\n</div>";

		expect(restoreRetaggedTables(retaggedTbody)).toBe(
			"<div><table>\n<tr><td>1d-interleaved-parityfec</td><td>application/1d-interleaved-parityfec</td></tr>\n<tr><td>3gpdash-qoe-report+xml</td><td>application/3gpdash-qoe-report+xml</td></tr>\n</table></div>",
		);
	});

	it("wraps a <table> that Readability retagged to <div> while it still holds its <tbody>", () => {
		const retaggedTable =
			"<div><tbody><tr><td>First comment</td></tr><tr><td>Second comment</td></tr></tbody></div>";

		expect(restoreRetaggedTables(retaggedTable)).toBe(
			"<div><table><tbody><tr><td>First comment</td></tr><tr><td>Second comment</td></tr></tbody></table></div>",
		);
	});

	it("wraps a retagged <table> holding a <thead> beside bare rows", () => {
		const retaggedTable =
			"<div><thead><tr><th>Property</th><th>Expected Type</th></tr></thead><tr><td>acceptedAnswer</td><td>Answer</td></tr></div>";

		expect(restoreRetaggedTables(retaggedTable)).toBe(
			"<div><table><thead><tr><th>Property</th><th>Expected Type</th></tr></thead><tr><td>acceptedAnswer</td><td>Answer</td></tr></table></div>",
		);
	});

	it("wraps a retagged <table> that kept its caption, column group, bare column and footer", () => {
		const retaggedTable =
			"<div><caption>Status codes</caption><colgroup><col></colgroup><col><tr><td>200</td><td>OK</td></tr><tfoot><tr><td>Total</td><td>1</td></tr></tfoot></div>";

		expect(restoreRetaggedTables(retaggedTable)).toBe(
			"<div><table><caption>Status codes</caption><colgroup><col></colgroup><col><tr><td>200</td><td>OK</td></tr><tfoot><tr><td>Total</td><td>1</td></tr></tfoot></table></div>",
		);
	});

	it("wraps the cells of a <tr> that Readability retagged to <div> in a table row", () => {
		const retaggedRow = "<div><th>Package</th><td>left-pad</td><td>1.3.0</td></div>";

		expect(restoreRetaggedTables(retaggedRow)).toBe(
			"<div><table><tr><th>Package</th><td>left-pad</td><td>1.3.0</td></tr></table></div>",
		);
	});

	it("unwraps a retagged single-row, single-cell layout table into its container", () => {
		const retaggedLayoutTable =
			'<div width="435"><tr><td><font size="2" face="verdana">April 2001<br><br>This essay is derived from a talk.</font></td></tr></div>';

		expect(restoreRetaggedTables(retaggedLayoutTable)).toBe(
			'<div width="435"><font size="2" face="verdana">April 2001<br><br>This essay is derived from a talk.</font></div>',
		);
	});

	it("unwraps a retagged single-cell table that kept an explicit <tbody>", () => {
		const retaggedLayoutTable = "<div><tbody><tr><td><p>Whole essay</p></td></tr></tbody></div>";

		expect(restoreRetaggedTables(retaggedLayoutTable)).toBe("<div><p>Whole essay</p></div>");
	});

	it("unwraps the lone cell a retagged <tr> leaves behind", () => {
		const retaggedRow = '<div id="bigbox"><td><p>Ask HN: first comment</p></td></div>';

		expect(restoreRetaggedTables(retaggedRow)).toBe('<div id="bigbox"><p>Ask HN: first comment</p></div>');
	});

	it("unwraps a lone header cell nested inside a retagged single-cell table, keeping the text of both cells", () => {
		const retaggedLayoutTable = "<div><tr><td>Essay text <th>Note</th></td></tr></div>";

		expect(restoreRetaggedTables(retaggedLayoutTable)).toBe("<div>Essay text Note</div>");
	});

	it("leaves a paragraph that mixes inline content with an orphan cell byte-identical", () => {
		const sponsorParagraph = "<p><i>Sponsor</i><td>Ad copy</td></p>";

		expect(restoreRetaggedTables(sponsorParagraph)).toBe("<p><i>Sponsor</i><td>Ad copy</td></p>");
	});

	it("returns a body whose table parts all sit inside a <table> exactly as given", () => {
		const wellFormedTable = "<table class=grid><tr><td>a<br/>b</td></tr></table>";

		expect(restoreRetaggedTables(wellFormedTable)).toBe("<table class=grid><tr><td>a<br/>b</td></tr></table>");
	});
});

describe("restoreRetaggedTables end-to-end through parseHtml", () => {
	const { parseHtml } = initReadabilityParser({
		crawlArticle: async () => ({ status: "fetched" as const, html: "", bodyHash: "a".repeat(64) }),
		siteRules: [],
		readabilityAdditions,
		logError: () => {},
	});

	it("keeps a registry's rows in a table after Readability retags its <tbody> to <div>", () => {
		const registryPage =
			"<html><head><title>Media Types</title></head><body><table><thead><tr><th>Name</th><th>Reference</th></tr></thead><tbody><tr><td>alpha</td><td>Registered by the alpha working group, see RFC 9001</td></tr><tr><td>beta</td><td>Registered by the beta working group, see RFC 9002</td></tr><tr><td>gamma</td><td>Registered by the gamma working group, see RFC 9003</td></tr></tbody></table></body></html>";

		const result = parseHtml({
			url: "https://registry.example/media-types",
			documentUrl: "https://registry.example/media-types",
			html: registryPage,
			thumbnailUrl: null,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.article.content).toBe(
			'<div class="page" id="readability-page-1"><div><table><tr><td>alpha</td><td>Registered by the alpha working group, see RFC 9001</td></tr><tr><td>beta</td><td>Registered by the beta working group, see RFC 9002</td></tr><tr><td>gamma</td><td>Registered by the gamma working group, see RFC 9003</td></tr></table></div></div>',
		);
	});
});
