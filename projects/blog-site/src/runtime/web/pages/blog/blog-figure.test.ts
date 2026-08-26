import { parseFigure } from "./blog-figure.parse";
import { renderFigure } from "./blog-figure.render";

function draw(body: string, index = 1): string {
	return renderFigure(parseFigure(body), index);
}

const BARS = `
kind: bars
title: Vision model out, Tesseract in
note: Same 31-page scan, both architectures.
before: Vision-LLM pipeline
after: Tesseract pipeline
row: Orchestrator wall clock | 317 | 317 s | 48 | 48 s
row: Calls to an external API | 31 | 31 | 0 | 0
`;

const WALK = `
kind: walk
title: Where a scanned page goes
toggle: This stage's guardrail rejects the output
step: Tesseract | Local engine, no network call | Nothing below it to fall back to
step: Stage 1 | One model call per page | The original Tesseract text passes through
step: Reader view | Fragments stitched | Still renders
`;

const MATRIX = `
kind: matrix
title: Three fetchers, one redirect
toggle: After the three loops became one
head: The hop | curl | HTTP/2
row: Relative Location | Resolved against the current hop>>Resolved against the current hop | !Resolved against the site root>>Resolved against the current hop
row: Five slow hops | One budget across the chain>>One budget across the chain | ?>>One budget across the chain
`;

const BUDGET = `
kind: budget
title: Twenty slots, and what fills them
note: A save keeps 20 images.
input: Versions the page ships per photo
oldLabel: Old rule counts files
newLabel: New rule counts photos
unit: whole photos that survive the save
step: 1 | 20 | 20
step: 2 | 10 | 20
step: 8 | 2 | 20
`;

const RULE = `
kind: rule
title: Does the next-charge line show?
choice: The renewal date | inside the 30 days before the charge | further out than 30 days
choice: Where the page is open | a browser | inside the Readplace iPhone app
flag: The stored copy is missing, stale, or already past
when: c1=2 -> no | Hidden | The line has a window: the 30 days before the charge, and it stays hidden the rest of the year.
when: c2=2 -> no | Hidden | Apple's rules stop a web view inside an app from naming a subscription price.
when: f1 -> ok | Shown live | A stored copy that is missing, stale or past is refetched from the provider before the line renders.
else: ok | Shown | Inside the window, outside the app, and the stored date still ahead, so the line shows.
`;

describe("rp-figure grammar", () => {
	it("should reject a line that is not key: value", () => {
		expect(() => parseFigure("kind bars")).toThrow(/not "key: value"/);
	});

	it("should reject an unknown kind", () => {
		expect(() => parseFigure("kind: pie\ntitle: t")).toThrow();
	});

	it("should reject a missing required key", () => {
		expect(() => parseFigure("title: t")).toThrow(/exactly one "kind:"/);
	});

	it("should reject a repeated key that must be unique", () => {
		expect(() => parseFigure(`${BARS}\ntitle: Twice`)).toThrow(/exactly one "title:"/);
	});

	it("should reject a repeated optional key", () => {
		expect(() => parseFigure(`${BARS}\nnote: Twice`)).toThrow(/at most once/);
	});

	it("should reject a row with the wrong field count", () => {
		expect(() => parseFigure(`${BARS}\nrow: Only | two`)).toThrow(/needs 5 fields/);
	});

	it("should reject a value that should be a number and is not", () => {
		const body = BARS.replace("| 317 | 317 s", "| lots | 317 s");
		expect(() => parseFigure(body)).toThrow();
	});
});

describe("bars figures", () => {
	it("should scale each row to its own larger value and print both numbers", () => {
		const html = draw(BARS);
		expect(html).toContain("width:100.0%");
		expect(html).toContain("width:15.1%");
		expect(html).toContain("width:0.0%");
		expect(html).toContain("317 s");
		expect(html).toContain("48 s");
	});

	it("should name both series", () => {
		expect(draw(BARS)).toContain("Vision-LLM pipeline");
		expect(draw(BARS)).toContain("Tesseract pipeline");
	});

	it("should require at least one row", () => {
		const body = BARS.split("\n").filter((line) => !line.startsWith("row:")).join("\n");
		expect(() => parseFigure(body)).toThrow(/at least one row/);
	});

	it("should reject a row with nothing to draw", () => {
		expect(() => parseFigure(`${BARS}\nrow: Nothing | 0 | none | 0 | none`)).toThrow(/nothing to draw/);
	});

	it("should reject a negative value", () => {
		expect(() => parseFigure(`${BARS}\nrow: Below | -1 | -1 | 2 | 2`)).toThrow(/negative/);
	});
});

describe("walk figures", () => {
	it("should render one radio and one step per stage, with the first selected", () => {
		const html = draw(WALK);
		expect(html.match(/rpf-walk__pick/g)).toHaveLength(3);
		expect(html.match(/rpf-walk__step/g)).toHaveLength(3);
		expect(html).toContain('id="rpf-1-s0" class="rpf-walk__pick" checked');
	});

	it("should carry both a what-it-does and a what-it-refuses note per stage", () => {
		const html = draw(WALK);
		expect(html).toContain("Local engine, no network call");
		expect(html).toContain("Nothing below it to fall back to");
	});

	it("should require at least two steps", () => {
		expect(() => parseFigure("kind: walk\ntitle: t\ntoggle: g\nstep: a | b | c")).toThrow(/2 to 10 steps/);
	});
});

describe("matrix figures", () => {
	it("should mark a cell the post reports as broken", () => {
		expect(draw(MATRIX)).toContain("rpf-matrix__cell--differs");
	});

	it("should render an unreported cell as not reported rather than filling it in", () => {
		const html = draw(MATRIX);
		expect(html).toContain("rpf-matrix__cell--unreported");
		expect(html).toContain("not reported");
	});

	it("should mark only the cells the fix moved", () => {
		expect(draw(MATRIX).match(/rpf-matrix__cell--now/g)).toHaveLength(1);
	});

	it("should not claim a cell moved when the post never reported where it started", () => {
		const unreported = draw(MATRIX).split("<td>").find((cell) => cell.includes("--unreported"));
		expect(unreported).not.toContain("rpf-matrix__cell--now");
	});

	it("should require two columns", () => {
		expect(() => parseFigure("kind: matrix\ntitle: t\ntoggle: g\nhead: corner | one\nrow: r | a>>b")).toThrow(
			/at least two columns/,
		);
	});

	it("should require at least one row", () => {
		expect(() => parseFigure("kind: matrix\ntitle: t\ntoggle: g\nhead: c | one | two")).toThrow(/at least one row/);
	});

	it("should reject a cell missing its after half", () => {
		const body = MATRIX.replace(">>Resolved against the current hop |", " |");
		expect(() => parseFigure(body)).toThrow(/needs "before >> after"/);
	});
});

describe("budget figures", () => {
	it("should select the last step, which is the case the post argues about", () => {
		const html = draw(BUDGET);
		expect(html).toContain('id="rpf-1-a2" class="rpf-budget__pick" checked');
		expect(html).toContain("rpf-budget__state--fallback");
	});

	it("should scale both columns against the largest count in the figure", () => {
		const html = draw(BUDGET);
		expect(html).toContain("height:100.0%");
		expect(html).toContain("height:10.0%");
	});

	it("should require at least two steps", () => {
		const body = BUDGET.split("\n").filter((line) => !line.startsWith("step: 2") && !line.startsWith("step: 8")).join("\n");
		expect(() => parseFigure(body)).toThrow(/2 to 10 steps/);
	});
});

describe("rule figures", () => {
	it("should tag every input with the branch it decides, and only those", () => {
		const html = draw(RULE);
		expect(html).toContain('id="rpf-1-c0o1" class="rpf-rule__input" data-fires="1"');
		expect(html).toContain('id="rpf-1-c1o1" class="rpf-rule__input" data-fires="2"');
		expect(html).toContain('id="rpf-1-f0" class="rpf-rule__input" data-fires="3"');
		expect(html).toContain('id="rpf-1-c0o0" class="rpf-rule__input" checked');
	});

	it("should render one outcome per branch plus the fallback", () => {
		const html = draw(RULE);
		expect(html).toContain('data-out="1"');
		expect(html).toContain('data-out="3"');
		expect(html).toContain('data-out="else"');
		expect(html).toContain("rpf-rule__outcome--fallback");
	});

	it("should colour a verdict by its stated tone", () => {
		const html = draw(RULE);
		expect(html).toContain("rpf-rule__outcome--ok");
		expect(html).toContain("rpf-rule__outcome--no");
	});

	it("should work with no flags at all", () => {
		const body = RULE.split("\n")
			.filter((line) => !line.startsWith("flag:") && !line.startsWith("when: f1"))
			.join("\n");
		const html = draw(body);
		expect(html).not.toContain("rpf-rule__group--flags");
		expect(html).toContain('data-out="1"');
	});

	it("should reject an atom that is not cN=M or fN", () => {
		expect(() => parseFigure(RULE.replace("when: f1 ->", "when: nope ->"))).toThrow(/not a valid atom/);
	});

	it("should reject an atom naming a flag that does not exist", () => {
		expect(() => parseFigure(RULE.replace("when: f1 ->", "when: f9 ->"))).toThrow(/flag that does not exist/);
	});

	it("should reject an atom naming a choice group that does not exist", () => {
		expect(() => parseFigure(RULE.replace("when: c1=2 ->", "when: c9=2 ->"))).toThrow(/choice group that does not exist/);
	});

	it("should reject a when line with no arrow", () => {
		expect(() => parseFigure(RULE.replace("when: f1 -> ok |", "when: f1 ok |"))).toThrow(/needs "->"/);
	});

	it("should reject a tone that is not ok or no", () => {
		expect(() => parseFigure(RULE.replace("-> ok | Shown live | A stored copy", "-> maybe | Shown live | A stored copy"))).toThrow(
			/must be "ok" or "no"/,
		);
	});

	it("should reject a choice with fewer than two options", () => {
		expect(() => parseFigure(`${RULE}\nchoice: Lonely | only`)).toThrow(/at least two options/);
	});

	it("should reject a figure with no inputs to set", () => {
		const body = "kind: rule\ntitle: t\nwhen: f1 -> ok | Yes | because\nelse: no | No | because";
		expect(() => parseFigure(body)).toThrow(/flag that does not exist/);
	});

	it("should require at least one when line", () => {
		const body = RULE.split("\n").filter((line) => !line.startsWith("when:")).join("\n");
		expect(() => parseFigure(body)).toThrow(/1 to 4 when lines/);
	});

	it("should reject more branches than the stylesheet can order", () => {
		const extra = ["when: c1=1 -> ok | A | one", "when: c2=1 -> ok | B | two"].join("\n");
		expect(() => parseFigure(`${RULE}\n${extra}`)).toThrow(/1 to 4 when lines/);
	});

	it("should reject an atom that decides more than one branch", () => {
		const body = RULE.replace("when: c2=2 ->", "when: c1=2 ->");
		expect(() => parseFigure(body)).toThrow(/decides more than one when/);
	});
});

describe("figure markup", () => {
	it("should escape author text rather than pass it through as markup", () => {
		const body = MATRIX.replace("Relative Location", 'Relative <Location> & "quoted"');
		const html = draw(body);
		expect(html).toContain("&lt;Location&gt; &amp; &quot;quoted&quot;");
		expect(html).not.toContain("<Location>");
	});

	it("should carry the note only when the figure has one", () => {
		expect(draw(BARS)).toContain("rpf__note");
		expect(draw(WALK)).not.toContain("rpf__note");
	});

	it("should give each figure on a page its own input ids", () => {
		expect(draw(WALK, 1)).toContain('id="rpf-1-s0"');
		expect(draw(WALK, 2)).toContain('id="rpf-2-s0"');
	});

	it("should render every kind", () => {
		for (const [body, marker] of [
			[BARS, "rpf-bars"],
			[WALK, "rpf-walk"],
			[MATRIX, "rpf-matrix"],
			[BUDGET, "rpf-budget"],
			[RULE, "rpf-rule"],
		] as const) {
			expect(draw(body)).toContain(marker);
		}
	});
});
