import assert from "node:assert/strict";
import type { CoverageOutcome } from "@packages/domain/article";
import { parseHTML } from "linkedom";
import type { SourceInspection } from "./coverage-rule.types";
import { activateCoverageRules, initArticleCoverageRules } from "./coverage-rules";
import { sectionCoverageRule } from "./section-coverage-rule";

const PAGE = "https://example.com/guide";

function words(prefix: string, count: number): string {
	return Array.from({ length: count }, (_, i) => `${prefix}w${i}`).join(" ");
}

function toc(ids: readonly string[]): string {
	return `<nav>${ids.map((id) => `<a href="#${id}">${id}</a>`).join("")}</nav>`;
}

function wrapped(n: number, body = `<p>${words(`s${n}`, 60)}</p>`): string {
	return `<div class="wrap" id="s${n}"><h2>Part ${n}</h2><div class="blk"><div class="body">${body}</div></div></div>`;
}

function range(count: number): readonly number[] {
	return Array.from({ length: count }, (_, i) => i + 1);
}

function inspect(body: string): SourceInspection {
	const rules = activateCoverageRules({ rules: initArticleCoverageRules(), modes: { "section-coverage": "shadow" } });
	const [inspection] = rules.inspect({
		html: `<!DOCTYPE html><html><head><title>Guide</title></head><body>${body}</body></html>`,
		documentUrl: PAGE,
	});
	return inspection;
}

function inspected(body: string): Extract<SourceInspection, { kind: "inspected" }> {
	const inspection = inspect(body);
	assert.equal(inspection.kind, "inspected", JSON.stringify(inspection));
	assert(inspection.kind === "inspected");
	return inspection;
}

function verify(params: { inspection: SourceInspection; readerHtml: string; media?: ReadonlyMap<string, string> }): CoverageOutcome {
	assert(params.inspection.kind === "inspected");
	return params.inspection.verify({ readerHtml: params.readerHtml, media: params.media ?? new Map() });
}

const verified = (units: number) => ({ outcome: "verified-for-scope", scope: { kind: "article", units }, covered: units });

describe("section-coverage rule on synthetic pages", () => {
	it("S1 (synthetic Clojure outline): a four-entry outline cannot certify sixteen headed sections", () => {
		const sections = range(16).map((n) => wrapped(n, `<p>${words(`s${n}`, 90)}</p>`));
		const inspection = inspected(`${toc(["s1", "s2", "s3", "s4"])}<article>${sections.join("")}</article>`);
		expect(verify({ inspection, readerHtml: sections.join("") })).toEqual(verified(16));
		expect(verify({ inspection, readerHtml: sections.slice(0, 4).join("") })).toEqual({
			outcome: "known-partial",
			scope: { kind: "article", units: 16 },
			covered: 4,
			unresolved: 12,
			reasons: ["missing-section"],
		});
	});

	it("S2 (synthetic Japanese instructions): an identical preamble cannot stand in for a distinct instruction", () => {
		const preamble = "<p>以下の手順に従って設定してください。</p>";
		const steps = [
			["npm install", "依存関係を最初にまとめて取得します", "npm install"],
			["設定ファイルを編集する", "接続先の値を本番用に書き換えます", "vi config.yml"],
			["サーバーを再起動する", "変更を反映するために停止して起動します", "systemctl restart app"],
			["ログを確認する", "エラーが出ていないか最後に見直します", "tail -f app.log"],
		];
		const section = (i: number, full: boolean) =>
			`<div class="wrap" id="t${i}"><h2>手順${i + 1}</h2><div class="blk">${preamble}${
				full ? `<p>${steps[i][0]}</p><p>${steps[i][1]}</p><pre>${steps[i][2]}</pre>` : ""
			}</div></div>`;
		const full = steps.map((_, i) => section(i, true)).join("");
		const inspection = inspected(`<article>${full}</article>`);
		expect(verify({ inspection, readerHtml: full })).toEqual(verified(4));
		const onlyFirst = steps.map((_, i) => section(i, i === 0)).join("");
		expect(verify({ inspection, readerHtml: onlyFirst })).toMatchObject({ outcome: "known-partial", covered: 1, unresolved: 3 });
	});

	it("S3 (synthetic lost map): an image passes at its origin or its mirror and fails when dropped", () => {
		const map = '<img data-src="map.png" src="placeholder.gif" data-srcset="map.png 1x">';
		const sections = [wrapped(1), wrapped(2, `<p>${words("s2", 60)}</p>${map}`), wrapped(3)];
		const inspection = inspected(`<article>${sections.join("")}</article>`);
		const reader = (img: string) => [wrapped(1), wrapped(2, `<p>${words("s2", 60)}</p>${img}`), wrapped(3)].join("");
		expect(verify({ inspection, readerHtml: reader("") })).toMatchObject({ unresolved: 1, reasons: ["missing-image"] });
		expect(
			verify({
				inspection,
				readerHtml: reader('<img src="https://cdn.example.net/m.png">'),
				media: new Map([["https://example.com/map.png", "https://cdn.example.net/m.png"]]),
			}),
		).toEqual(verified(3));
		expect(verify({ inspection, readerHtml: reader('<img src="https://example.com/map.png">') })).toEqual(verified(3));
	});

	it("S4 (synthetic swapped table): the same bag of words with two values swapped is a table mismatch", () => {
		const table = (a: string, b: string) =>
			`<table><tr><th>Area</th><th>Count</th></tr><tr><td>North field</td><td>${a}</td></tr><tr><td>South field</td><td>${b}</td></tr><tr><td>East field</td><td>5</td></tr><tr><td>West field</td><td>9</td></tr></table>`;
		const page = (a: string, b: string) => [wrapped(1), wrapped(2, `<p>${words("s2", 60)}</p>${table(a, b)}`), wrapped(3)].join("");
		const inspection = inspected(`<article>${page("12", "7")}</article>`);
		expect(verify({ inspection, readerHtml: page("12", "7") })).toEqual(verified(3));
		expect(verify({ inspection, readerHtml: page("7", "12") })).toMatchObject({ unresolved: 1, reasons: ["table-mismatch"] });
	});

	it("S5 (synthetic correction): dropping one middle paragraph fails that section only", () => {
		const correction = "<p>Update: the earlier step 2 was wrong; use the blue valve instead of the red one.</p>";
		const page = (fix: string) =>
			range(5)
				.map((n) => wrapped(n, `<p>${words(`s${n}`, 60)}</p>${n === 3 ? fix : ""}`))
				.join("");
		const inspection = inspected(`<article>${page(correction)}</article>`);
		expect(verify({ inspection, readerHtml: page("") })).toEqual({
			outcome: "known-partial",
			scope: { kind: "article", units: 5 },
			covered: 4,
			unresolved: 1,
			reasons: ["missing-section"],
		});
	});

	it("S6 (synthetic nested section): a reader repeating the nested body is duplicated", () => {
		const nested = `<p>${words("a", 40)}</p><section id="a1"><h3>Inner</h3><p>${words("a1", 40)}</p></section>`;
		const sections = [wrapped(1), wrapped(2, nested), wrapped(3)];
		const inspection = inspected(`<article>${sections.join("")}</article>`);
		expect(verify({ inspection, readerHtml: sections.join("") })).toEqual(verified(3));
		const repeated = [wrapped(1), wrapped(2, `${nested}<p>${words("a1", 40)}</p>`), wrapped(3)].join("");
		expect(verify({ inspection, readerHtml: repeated })).toMatchObject({ unresolved: 1, reasons: ["duplicated-section"] });
	});

	it("S7 (synthetic directory): blurbs linking to other pages abstain and offer no alternative", () => {
		const items = range(30)
			.map((n) => `<li><h3><a href="https://example.com/entry-${n}">Entry ${n}</a></h3><p>${words(`d${n}`, 20)}</p></li>`)
			.join("");
		expect(inspect(`<article><ul>${items}</ul></article>`)).toEqual({
			ruleId: "section-coverage",
			ruleVersion: 1,
			mode: "shadow",
			kind: "abstained",
			reason: "no-section-structure",
		});
	});

	const teasers = (linked: boolean) =>
		`<div class="more">${range(4)
			.map(
				(n) =>
					`<div class="teaser"><h3>${linked ? `<a href="https://news.example.org/story-${n}">Story ${n}</a>` : `Story ${n}`}</h3><p>${words(`t${n}`, 25)}</p></div>`,
			)
			.join("")}</div>`;

	it("S8 (synthetic related panel) inside the section flow abstains", () => {
		expect(inspect(`<article>${range(3).map((n) => wrapped(n)).join("")}${teasers(false)}</article>`)).toMatchObject({
			kind: "abstained",
			reason: "adjacent-repeated-block",
		});
	});

	it("S8 (synthetic related panel) beside the region is left out of the units and the alternative", () => {
		const sections = range(3).map((n) => wrapped(n));
		const inspection = inspected(
			`${toc(["s1", "s2", "s3"])}<div class="page"><div id="content">${sections.join("")}</div>${teasers(true)}</div>`,
		);
		expect(verify({ inspection, readerHtml: sections.join("") })).toEqual(verified(3));
		expect(inspection.recoveredBodyHtml).toContain("s3w59");
		expect(inspection.recoveredBodyHtml).not.toContain("t1w0");
	});

	it("S9 (synthetic comment thread) right after the last section abstains", () => {
		const comments = range(10)
			.map((n) => `<li class="comment"><h4>Reader ${n}</h4><p>${words(`c${n}`, 40)}</p></li>`)
			.join("");
		const body = `<div class="page">${range(3)
			.map((n) => wrapped(n, `<p>${words(`s${n}`, 100)}</p>`))
			.join("")}<div id="comments"><ol>${comments}</ol></div></div>`;
		expect(inspect(body)).toMatchObject({ kind: "abstained", reason: "adjacent-repeated-block" });
	});

	it("S10 (synthetic hidden panels): hidden material is neither a unit nor recovered, and a class named invisible stays owned", () => {
		const invisible = '<table class="invisible"><tr><td>Grab the lantern from the shrine before dusk falls</td></tr></table>';
		const hidden = [
			'<div hidden><h2>Share</h2><form><input name="q"></form><p>hiddenshare words here</p></div>',
			`<div style="display:none"><h2>Report</h2><p>${words("hr", 50)}</p></div>`,
			`<div aria-hidden="true"><h2>Tools</h2><p>${words("ht", 50)}</p></div>`,
		];
		const sections = [wrapped(1), wrapped(2, `<p>${words("s2", 60)}</p>${invisible}`), wrapped(3)];
		const inspection = inspected(`<article>${sections[0]}${hidden.join("")}${sections[1]}${sections[2]}</article>`);
		expect(verify({ inspection, readerHtml: sections.join("") })).toEqual(verified(3));
		expect(verify({ inspection, readerHtml: sections.join("").replace(invisible, "") })).toMatchObject({
			unresolved: 1,
			reasons: ["missing-section"],
		});
		expect(inspection.recoveredBodyHtml).toContain("Grab the lantern");
		expect(inspection.recoveredBodyHtml).not.toMatch(/hiddenshare|hrw0|htw0/);
	});

	it("S11 (synthetic direct div text): lines split by br are each verified once, in order", () => {
		const lines = (order: readonly number[]) =>
			`<div>${order.map((line) => words(`l${line}`, 20)).join("<br>")}</div>`;
		const page = (order: readonly number[]) =>
			[wrapped(1, lines([1, 2, 3])), wrapped(2, lines(order)), wrapped(3, lines([7, 8, 9]))].join("");
		const inspection = inspected(`<article>${page([4, 5, 6])}</article>`);
		expect(verify({ inspection, readerHtml: page([4, 5, 6]) })).toEqual(verified(3));
		expect(verify({ inspection, readerHtml: page([5, 4, 6]) })).toMatchObject({ unresolved: 1, reasons: ["section-out-of-order"] });
		expect(verify({ inspection, readerHtml: page([4, 5, 6, 5]) })).toMatchObject({ unresolved: 1, reasons: ["duplicated-section"] });
	});

	it("S12 (synthetic legacy anchors): named anchors with no heading form the units", () => {
		const parts = range(4).map((n) => `<div class="blk"><a name="part${n}"></a><b>Part ${n}</b><br>${words(`p${n}`, 50)}</div>`);
		const inspection = inspected(`${toc(range(4).map((n) => `part${n}`))}<article>${parts.join("")}</article>`);
		expect(verify({ inspection, readerHtml: parts.join("") })).toEqual(verified(4));
		expect(verify({ inspection, readerHtml: parts.slice(1).join("") })).toMatchObject({ covered: 3, unresolved: 1 });
	});

	it("S13 (synthetic nested sections): eight leaves at three levels are each emitted once, in order", () => {
		const leaf = (n: number) => `<div class="sect3"><h4>Leaf ${n}</h4><p>${words(`leaf${n}`, 30)}</p></div>`;
		const page = (leaves: readonly number[]) =>
			range(4)
				.map(
					(top) =>
						`<div class="sect1" id="top${top}"><h2>Top ${top}</h2><div class="sect2"><h3>Middle ${top}</h3>${leaves
							.slice((top - 1) * 2, top * 2)
							.map(leaf)
							.join("")}</div></div>`,
				)
				.join("");
		const inspection = inspected(`<article>${page(range(8))}</article>`);
		expect(verify({ inspection, readerHtml: page(range(8)) })).toEqual(verified(4));
		expect(verify({ inspection, readerHtml: page([1, 2, 4, 3, 5, 6, 7, 8]) })).toMatchObject({
			unresolved: 1,
			reasons: ["section-out-of-order"],
		});
	});

	it("S14 (synthetic unheaded material): an introduction and an appendix are units of their own runs", () => {
		const intro = `<p>${words("intro", 30)}</p><p>${words("lede", 30)}</p>`;
		const appendix = `<p>${words("appendix", 30)}</p>`;
		const flat = range(3)
			.map((n) => `<h2>Part ${n}</h2><p>${words(`s${n}`, 50)}</p>`)
			.join("");
		const inspection = inspected(`<article>${intro}${flat}${appendix}</article>`);
		expect(verify({ inspection, readerHtml: `${intro}${flat}${appendix}` })).toEqual(verified(4));
		expect(verify({ inspection, readerHtml: `${intro}${flat}` })).toMatchObject({ outcome: "known-partial", covered: 3, unresolved: 1 });
		expect(verify({ inspection, readerHtml: `${flat}${appendix}` })).toMatchObject({ outcome: "known-partial", covered: 3, unresolved: 1 });
	});

	it("S14b (synthetic local chapter): a 60-word introduction outside the region abstains", () => {
		const sections = range(3).map((n) => wrapped(n)).join("");
		expect(inspect(`<div class="page"><p>${words("outside", 60)}</p><div id="content">${sections}</div></div>`)).toMatchObject({
			kind: "abstained",
			reason: "material-outside-region",
		});
	});

	it("S14b (synthetic two chapters): a second chapter the outline does not reach abstains", () => {
		const chapter = (prefix: string, count: number) =>
			`<div class="chapter">${range(3)
				.map((n) => `<div class="wrap" id="${prefix}${n}"><h2>${prefix} ${n}</h2><p>${words(`${prefix}${n}`, count)}</p></div>`)
				.join("")}</div>`;
		expect(inspect(`${toc(["a1", "a2", "a3"])}<div class="page">${chapter("a", 70)}<div class="chapter"><h2>Next chapter</h2><p>${words("b", 60)}</p></div></div>`)).toMatchObject({
			kind: "abstained",
			reason: "material-outside-region",
		});
	});

	it("abstains when fewer than three units hold a probe", () => {
		const headingOnly = (n: number) => `<div class="wrap" id="h${n}"><h2>${words(`h${n}`, 60)}</h2></div>`;
		const body = `<article>${wrapped(1)}${wrapped(2)}${headingOnly(3)}${headingOnly(4)}</article>`;
		expect(inspect(body)).toMatchObject({ kind: "abstained", reason: "no-section-structure" });
	});
});

function heldValues(value: unknown): readonly unknown[] {
	if (Array.isArray(value)) {
		return value.flatMap(heldValues);
	}
	if (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
		return Object.values(value).flatMap(heldValues);
	}
	return [value];
}

describe("section-coverage rule evidence", () => {
	it("holds no node of the source document, so the source DOM can be collected while an inspection is held", () => {
		const sections = range(3).map((n) => wrapped(n));
		const { document } = parseHTML(
			`<!DOCTYPE html><html><body>${toc(["s1", "s2", "s3"])}<article>${sections.join("")}</article></body></html>`,
		);
		const result = sectionCoverageRule.inspect({ document, documentUrl: PAGE });
		assert(result.kind === "evidence");
		const held = heldValues(result.evidence);
		expect(held.length).toBeGreaterThan(0);
		expect(held.filter((value) => typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")).toEqual([]);
		expect(result.evidence.recoveredBodyHtml).toContain("s3w59");
	});
});
