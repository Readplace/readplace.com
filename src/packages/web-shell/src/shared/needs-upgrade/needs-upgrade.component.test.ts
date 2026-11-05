import assert from "node:assert/strict";
import { findIconSvg } from "@packages/ui-icons";
import { JSDOM } from "jsdom";
import { NEEDS_UPGRADE_STYLES, renderNeedsUpgrade } from "./needs-upgrade.component";

const FALLBACK_HREF = "/account/plans?utm_source=queue-nav&utm_medium=internal&utm_content=upgrade-create-readlist";

const LOCK = renderNeedsUpgrade({
	key: "create-readlist",
	label: "Create a readlist",
	controlClass: "readlist-row__main readlist-nav__new",
	popoverId: "subscribe-plans",
	fallbackHref: FALLBACK_HREF,
});

function controlFor(selector: string): Element {
	const control = new JSDOM(LOCK).window.document.querySelector(selector);
	assert(control, `${selector} must render`);
	return control;
}

const CONTROLS = [
	{ name: "trigger", selector: 'button[data-test-action="upgrade-open"]' },
	{ name: "fallback", selector: 'a[data-test-action="upgrade-fallback"]' },
];

describe("renderNeedsUpgrade", () => {
	it("opens the plan chooser from a button that submits nothing", () => {
		const trigger = controlFor("button");
		expect(trigger.getAttribute("type")).toBe("button");
		expect(trigger.getAttribute("popovertarget")).toBe("subscribe-plans");
		expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
	});

	it("falls back to a whole-page load of the tracked plans link, since a boosted host would otherwise swap it", () => {
		const fallback = controlFor("a");
		expect(fallback.getAttribute("href")).toBe(FALLBACK_HREF);
		expect(fallback.getAttribute("hx-boost")).toBe("false");
	});

	it.each(CONTROLS)("draws the $name with the control's own classes, its label, the lock and the Upgrade chip", ({ selector }) => {
		const control = controlFor(selector);
		expect(control.classList.contains("readlist-row__main")).toBe(true);
		expect(control.classList.contains("readlist-nav__new")).toBe(true);
		expect(control.classList.contains("needs-upgrade")).toBe(true);
		expect(control.getAttribute("data-test-needs-upgrade")).toBe("create-readlist");
		expect(control.querySelector(".needs-upgrade__label")?.textContent).toBe("Create a readlist");
		expect(control.querySelector(".needs-upgrade__chip")?.textContent).toBe("Upgrade");
		const drawn = control.querySelector("svg");
		const lock = new JSDOM(findIconSvg("lock")).window.document.querySelector("svg");
		assert(drawn, "the lock must be drawn");
		assert(lock, "the shared set must hold the lock");
		expect(drawn.innerHTML).toBe(lock.innerHTML);
	});

	it("ships a stylesheet that shows the fallback until the browser supports popovers", () => {
		expect(NEEDS_UPGRADE_STYLES).toContain("@supports selector(:popover-open)");
	});
});
