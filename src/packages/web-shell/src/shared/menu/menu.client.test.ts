import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import { initFloatingMenus } from "./menu.client";

interface Rect {
	top: number;
	bottom: number;
	left: number;
	right: number;
}

interface Setup {
	window: JSDOM["window"];
	el: (selector: string) => HTMLElement;
	errors: string[];
}

function menuMarkup(name: string): string {
	return `<details class="menu" data-test-menu="${name}"><summary class="menu__toggle">Options</summary><div class="menu__panel"><button class="menu__item">Delete</button></div></details>`;
}

function setup(innerHeight: number): Setup {
	const errors: string[] = [];
	const virtualConsole = new VirtualConsole();
	virtualConsole.on("jsdomError", (error) => errors.push(error.message));
	const dom = new JSDOM(
		`<body>${menuMarkup("first")}${menuMarkup("second")}<details data-test-plain><summary>Plain</summary><div class="menu__panel">Edit</div></details><details class="menu" data-test-bare><summary>Bare</summary></details><div popover data-test-popover></div></body>`,
		{ virtualConsole },
	);
	const { window } = dom;
	Object.defineProperty(window, "innerHeight", { value: innerHeight });
	initFloatingMenus({ document: window.document });
	const el = (selector: string): HTMLElement => {
		const found = window.document.querySelector<HTMLElement>(selector);
		assert(found, `${selector} must be rendered`);
		return found;
	};
	return { window, el, errors };
}

function openMenu(
	s: Setup,
	name: string,
	rects: {
		toggle: Rect;
		resting: { top: number; left: number; height: number; width: number };
		containingBlock: { top: number; left: number };
	},
): HTMLElement {
	const menu = s.el(`[data-test-menu="${name}"]`);
	Object.defineProperty(menu, "getBoundingClientRect", {
		configurable: true,
		value: () => ({ ...rects.toggle }),
	});
	const panel = s.el(`[data-test-menu="${name}"] .menu__panel`);
	Object.defineProperty(panel, "getBoundingClientRect", {
		configurable: true,
		value: () =>
			menu.classList.contains("menu--floating")
				? {
						top:
							Number.parseFloat(panel.style.getPropertyValue("--menu-top")) +
							rects.containingBlock.top,
						left:
							Number.parseFloat(panel.style.getPropertyValue("--menu-left")) +
							rects.containingBlock.left,
						height: rects.resting.height,
						width: rects.resting.width,
					}
				: { ...rects.resting },
	});
	menu.setAttribute("open", "");
	menu.dispatchEvent(new s.window.Event("toggle"));
	return menu;
}

function position(s: Setup, name: string): { top: string; left: string } {
	const panel = s.el(`[data-test-menu="${name}"] .menu__panel`);
	return {
		top: panel.style.getPropertyValue("--menu-top"),
		left: panel.style.getPropertyValue("--menu-left"),
	};
}

function openBoth(s: Setup): { first: Rect; second: Rect } {
	const first = { top: 40, bottom: 80, left: 200, right: 240 };
	const second = { top: 100, bottom: 140, left: 560, right: 600 };
	for (const [name, toggle] of [
		["first", first],
		["second", second],
	] as const)
		openMenu(s, name, {
			toggle,
			resting: {
				top: toggle.bottom,
				left: toggle.right - 150,
				height: 120,
				width: 150,
			},
			containingBlock: { top: 0, left: 0 },
		});
	return { first, second };
}

describe("initFloatingMenus", () => {
	it("floats an opened menu's panel where its styles rest it, keeping the gap below its toggle", () => {
		const s = setup(700);

		const menu = openMenu(s, "first", {
			toggle: { top: 40, bottom: 80, left: 200, right: 240 },
			resting: { top: 84, left: 90, height: 120, width: 150 },
			containingBlock: { top: 0, left: 0 },
		});

		assert.deepEqual(Array.from(menu.classList), ["menu", "menu--floating"]);
		assert.deepEqual(position(s, "first"), { top: "84px", left: "90px" });
	});

	it("flips the panel above its toggle, mirroring the gap, when it would leave the viewport and there is more room above", () => {
		const s = setup(700);

		openMenu(s, "first", {
			toggle: { top: 620, bottom: 660, left: 200, right: 240 },
			resting: { top: 664, left: 90, height: 120, width: 150 },
			containingBlock: { top: 0, left: 0 },
		});

		assert.deepEqual(position(s, "first"), { top: "496px", left: "90px" });
	});

	it("keeps the panel below its toggle when there is no more room above than below", () => {
		const s = setup(100);

		openMenu(s, "first", {
			toggle: { top: 20, bottom: 60, left: 200, right: 240 },
			resting: { top: 60, left: 90, height: 120, width: 150 },
			containingBlock: { top: 0, left: 0 },
		});

		assert.deepEqual(position(s, "first"), { top: "60px", left: "90px" });
	});

	it("offsets the position by the containing block the fixed panel is laid out in", () => {
		const s = setup(700);

		openMenu(s, "first", {
			toggle: { top: 40, bottom: 80, left: 200, right: 240 },
			resting: { top: 84, left: 90, height: 120, width: 150 },
			containingBlock: { top: 8, left: 8 },
		});

		assert.deepEqual(position(s, "first"), { top: "76px", left: "82px" });
	});

	it("measures a reopened menu where its styles rest it, not where it last floated", () => {
		const s = setup(700);
		const toggle = { top: 40, bottom: 80, left: 200, right: 240 };
		const menu = openMenu(s, "first", {
			toggle,
			resting: { top: 84, left: 90, height: 120, width: 150 },
			containingBlock: { top: 0, left: 0 },
		});
		menu.removeAttribute("open");
		menu.dispatchEvent(new s.window.Event("toggle"));

		openMenu(s, "first", {
			toggle,
			resting: { top: 184, left: 190, height: 120, width: 150 },
			containingBlock: { top: 0, left: 0 },
		});

		assert.deepEqual(position(s, "first"), { top: "184px", left: "190px" });
	});

	it("leaves closing menus, details that are not menus and other toggles alone", () => {
		const s = setup(700);

		s.el('[data-test-menu="first"]').dispatchEvent(
			new s.window.Event("toggle"),
		);
		s.el("[data-test-plain]").setAttribute("open", "");
		s.el("[data-test-plain]").dispatchEvent(new s.window.Event("toggle"));
		s.el("[data-test-popover]").dispatchEvent(new s.window.Event("toggle"));
		s.window.document.dispatchEvent(new s.window.Event("toggle"));

		assert.deepEqual(Array.from(s.el('[data-test-menu="first"]').classList), [
			"menu",
		]);
		assert.equal(
			s
				.el("[data-test-plain] .menu__panel")
				.style.getPropertyValue("--menu-top"),
			"",
		);
		assert.deepEqual(s.errors, []);
	});

	it("refuses a menu that opens without a panel", () => {
		const s = setup(700);

		s.el("[data-test-bare]").setAttribute("open", "");
		s.el("[data-test-bare]").dispatchEvent(new s.window.Event("toggle"));

		assert.deepEqual(s.errors, ["Uncaught [Error: a menu opens a panel]"]);
	});

	it("refuses a document outside a window", () => {
		const document = new JSDOM(
			"",
		).window.document.implementation.createHTMLDocument();

		assert.throws(() => initFloatingMenus({ document }), {
			message: "floating menus run in a window",
		});
	});

	it("closes an open menu when a scroll moved its toggle, leaving one whose toggle stayed put", () => {
		const s = setup(700);
		const toggles = openBoth(s);

		toggles.first.top -= 30;
		s.el("[data-test-popover]").dispatchEvent(new s.window.Event("scroll"));

		assert.equal(s.el('[data-test-menu="first"]').hasAttribute("open"), false);
		assert.equal(s.el('[data-test-menu="second"]').hasAttribute("open"), true);
	});

	it("keeps open menus open when a scroll left every toggle in place", () => {
		const s = setup(700);
		openBoth(s);

		s.window.document.dispatchEvent(new s.window.Event("scroll"));

		assert.equal(s.el('[data-test-menu="first"]').hasAttribute("open"), true);
		assert.equal(s.el('[data-test-menu="second"]').hasAttribute("open"), true);
	});

	it("closes an open menu when a resize moved its toggle sideways", () => {
		const s = setup(700);
		const toggles = openBoth(s);

		toggles.second.left += 40;
		s.window.dispatchEvent(new s.window.Event("resize"));

		assert.equal(s.el('[data-test-menu="first"]').hasAttribute("open"), true);
		assert.equal(s.el('[data-test-menu="second"]').hasAttribute("open"), false);
	});

	it("leaves an open menu alone on a scroll that lands before the menu is placed", () => {
		const s = setup(700);
		const toggles = openBoth(s);
		const menu = s.el('[data-test-menu="first"]');

		menu.removeAttribute("open");
		menu.dispatchEvent(new s.window.Event("toggle"));
		toggles.first.top -= 30;
		menu.setAttribute("open", "");
		s.window.document.dispatchEvent(new s.window.Event("scroll"));

		assert.equal(menu.hasAttribute("open"), true);
	});

	it("closes an open menu when a swap that fires no scroll moved its toggle", () => {
		const s = setup(700);
		const toggles = openBoth(s);

		toggles.first.top += 120;
		s.el("[data-test-popover]").dispatchEvent(
			new s.window.Event("htmx:afterSettle", { bubbles: true }),
		);

		assert.equal(s.el('[data-test-menu="first"]').hasAttribute("open"), false);
		assert.equal(s.el('[data-test-menu="second"]').hasAttribute("open"), true);
	});

	it("stops floating a menu once it closes", () => {
		const s = setup(700);
		openBoth(s);
		const menu = s.el('[data-test-menu="first"]');

		menu.removeAttribute("open");
		menu.dispatchEvent(new s.window.Event("toggle"));

		assert.deepEqual(Array.from(menu.classList), ["menu"]);
	});
});
