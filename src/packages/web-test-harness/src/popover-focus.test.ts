import { describePopoverFocusGaps, findPopoverFocusGaps } from "./popover-focus";

describe("findPopoverFocusGaps", () => {
	it("accepts a dialog whose one autofocus is on its commit control", () => {
		const found = findPopoverFocusGaps(
			'<div id="confirm" popover="auto" role="dialog" tabindex="-1"><button type="button">Cancel</button><button type="submit" autofocus>Delete</button></div>',
		);

		expect(found).toEqual([]);
	});

	it("reports a dialog that focuses its own panel, because the panel's attribute wins over every descendant's", () => {
		const found = findPopoverFocusGaps(
			'<div id="confirm" popover="auto" role="dialog" tabindex="-1" autofocus><button type="submit" autofocus>Delete</button></div>',
		);

		expect(found).toEqual([{ popover: "confirm", problem: "panel-autofocus" }]);
	});

	it("reports a dialog that opens on nothing", () => {
		const found = findPopoverFocusGaps('<div id="confirm" popover="auto" role="dialog"><button type="submit">Delete</button></div>');

		expect(found).toEqual([{ popover: "confirm", problem: "no-target" }]);
	});

	it("reports a dialog with two targets, because only the first in tree order would ever take focus", () => {
		const found = findPopoverFocusGaps(
			'<div id="confirm" popover="auto" role="dialog"><input autofocus><button type="submit" autofocus>Save</button></div>',
		);

		expect(found).toEqual([{ popover: "confirm", problem: "many-targets" }]);
	});

	it("reports both a panel autofocus and a missing target on today's panel shape", () => {
		const found = findPopoverFocusGaps('<div id="confirm" popover="auto" role="dialog" autofocus><button>Go</button></div>');

		expect(describePopoverFocusGaps(found)).toEqual(["panel-autofocus: confirm", "no-target: confirm"]);
	});

	it("counts a nested popover's target as its own, not its parent's", () => {
		const found = findPopoverFocusGaps(
			'<div id="outer" popover="auto" role="dialog"><button autofocus>Go</button><div id="inner" popover="auto" role="dialog"><input autofocus></div></div>',
		);

		expect(found).toEqual([]);
	});

	it("accepts a tooltip that takes no focus", () => {
		const found = findPopoverFocusGaps('<span id="tip" popover="manual" role="tooltip">Saved from your inbox</span>');

		expect(found).toEqual([]);
	});

	it("reports a tooltip carrying autofocus on itself or inside it", () => {
		const found = findPopoverFocusGaps(
			'<span id="own" popover="manual" role="tooltip" autofocus>Hint</span><div popover="manual"><a href="/x" autofocus>Link</a></div>',
		);

		expect(describePopoverFocusGaps(found)).toEqual(["tooltip-autofocus: own", "tooltip-autofocus: div"]);
	});

	it("ignores an autofocus outside every popover, such as a refused inline field", () => {
		const found = findPopoverFocusGaps('<form><input name="label" autofocus></form>');

		expect(found).toEqual([]);
	});
});
