import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initReadlistMore } from "./readlist-more.client";

function entry(slug: string, label: string): string {
	return `<li class="readlist-more__entry" data-readlist-switch-entry data-test-entry="${slug}"><a href="/queue?readlist=${slug}" data-test-link="${slug}"><span class="readlist-more__label">${label}</span></a><button type="button" data-test-menu="${slug}">Options</button></li>`;
}

function markup(): string {
	return `
	<div class="readlist__layout" style="column-gap: 24px">
		<aside class="readlist__rail">
			<ul class="readlist-nav__rail-list">
				<li><details class="menu readlist-nav__menu" data-test-rail-menu><summary>Options</summary><div class="menu__panel">Edit</div></details></li>
				<li><button type="button" popovertarget="readlist-more" data-test-opener>More</button></li>
			</ul>
		</aside>
	</div>
	<details class="menu readlist-nav__menu" data-test-loose-menu><summary>Options</summary><div class="menu__panel">Edit</div></details>
	<div id="readlist-more" popover data-readlist-switch data-test-switch>
		<div class="readlist-more__head" data-test-head>
			<h2>More readlists</h2>
			<input type="search" hidden data-readlist-switch-filter data-test-filter>
			<button type="button" popovertarget="readlist-more" popovertargetaction="hide" data-test-close>Close</button>
		</div>
		<div data-readlist-switch-body data-test-body>
			<ul>${entry("garden", "Gardening")}${entry("work", "Work Reading")}<li class="readlist-more__entry" data-readlist-switch-entry><a href="/queue?readlist=cur" aria-current="page" data-test-link="cur"><span class="readlist-more__label">Current</span></a></li></ul>
			<p data-readlist-switch-empty data-no-match="No readlists match" data-test-empty></p>
		</div>
	</div>
	<div id="other" popover data-test-other-popover><button type="button" data-test-other-button>Ok</button></div>
	<button type="button" data-test-outside>Outside</button>
	<input data-test-plain-input>
	`;
}

interface Setup {
	document: Document;
	window: JSDOM["window"];
	el: (selector: string) => HTMLElement;
	hidden: string[];
	scrolled: string[];
	focused: string[];
}

function setup(options: { overflow: boolean; finePointer: boolean }): Setup {
	const dom = new JSDOM(`<body>${markup()}</body>`);
	const { window } = dom;
	const document = window.document;
	const el = (selector: string): HTMLElement => {
		const found = document.querySelector<HTMLElement>(selector);
		assert(found, `${selector} must be rendered`);
		return found;
	};
	const hidden: string[] = [];
	const scrolled: string[] = [];
	const focused: string[] = [];
	Object.defineProperty(window, "matchMedia", {
		value: (query: string) => ({
			matches: query === "(pointer: fine)" && options.finePointer,
		}),
	});
	Object.defineProperty(el("[data-test-body]"), "scrollHeight", {
		value: options.overflow ? 500 : 100,
	});
	Object.defineProperty(el("[data-test-body]"), "clientHeight", { value: 100 });
	Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
		value(this: HTMLElement) {
			scrolled.push(String(this.getAttribute("data-test-link")));
		},
	});
	Object.defineProperty(el("[data-test-switch]"), "hidePopover", {
		value: () => hidden.push("readlist-more"),
	});
	el("[data-test-filter]").addEventListener("focus", () =>
		focused.push("filter"),
	);
	initReadlistMore({ document });
	return { document, window, el, hidden, scrolled, focused };
}

function toggle(s: Setup, selector: string, newState: "open" | "closed"): void {
	const event = new s.window.Event("toggle");
	Object.defineProperty(event, "newState", { value: newState });
	s.el(selector).dispatchEvent(event);
}

function typeFilter(s: Setup, value: string): void {
	const filter = s.el("[data-test-filter]");
	filter.setAttribute("value", value);
	Reflect.set(filter, "value", value);
	filter.dispatchEvent(new s.window.Event("input", { bubbles: true }));
}

function shownEntries(s: Setup): string[] {
	return Array.from(
		s.document.querySelectorAll<HTMLElement>("[data-readlist-switch-entry]"),
	)
		.filter((item) => !item.hidden)
		.map((item) =>
			String(item.querySelector("a")?.getAttribute("data-test-link")),
		);
}

describe("initReadlistMore", () => {
	it("reveals and focuses the filter on a fine pointer when the entries overflow, marking the opener expanded", () => {
		const s = setup({ overflow: true, finePointer: true });

		toggle(s, "[data-test-switch]", "open");

		assert.equal(s.el("[data-test-filter]").hidden, false);
		assert.ok(
			s
				.el("[data-test-head]")
				.classList.contains("readlist-more__head--filtering"),
		);
		assert.deepEqual(s.focused, ["filter"]);
		assert.equal(
			s.el("[data-test-opener]").getAttribute("aria-expanded"),
			"true",
		);
		assert.equal(s.el("[data-test-close]").getAttribute("aria-expanded"), null);
		assert.deepEqual(s.scrolled, ["cur"]);
		assert.equal(
			s.el("[data-test-switch]").style.getPropertyValue("--readlist-more-left"),
			"24px",
		);
	});

	it("reveals the filter without focusing it on a coarse pointer", () => {
		const s = setup({ overflow: true, finePointer: false });

		toggle(s, "[data-test-switch]", "open");

		assert.equal(s.el("[data-test-filter]").hidden, false);
		assert.deepEqual(s.focused, []);
	});

	it("keeps the filter hidden when every entry fits", () => {
		const s = setup({ overflow: false, finePointer: true });

		toggle(s, "[data-test-switch]", "open");

		assert.equal(s.el("[data-test-filter]").hidden, true);
		assert.equal(
			s
				.el("[data-test-head]")
				.classList.contains("readlist-more__head--filtering"),
			false,
		);
	});

	it("clears the filter, shows every entry and marks the opener collapsed on close", () => {
		const s = setup({ overflow: true, finePointer: true });
		toggle(s, "[data-test-switch]", "open");
		typeFilter(s, "zzz");

		toggle(s, "[data-test-switch]", "closed");

		assert.equal(Reflect.get(s.el("[data-test-filter]"), "value"), "");
		assert.deepEqual(shownEntries(s), ["garden", "work", "cur"]);
		assert.equal(s.el("[data-test-filter]").hidden, true);
		assert.equal(
			s
				.el("[data-test-head]")
				.classList.contains("readlist-more__head--filtering"),
			false,
		);
		assert.equal(
			s.el("[data-test-opener]").getAttribute("aria-expanded"),
			"false",
		);
		assert.equal(s.el("[data-test-empty]").textContent, "");
	});

	it("hides entries whose label lacks the query, case-insensitively", () => {
		const s = setup({ overflow: true, finePointer: true });

		typeFilter(s, "WORK");

		assert.deepEqual(shownEntries(s), ["work"]);
		assert.equal(s.el("[data-test-empty]").textContent, "");
	});

	it("announces the no-match status when no label holds the query", () => {
		const s = setup({ overflow: true, finePointer: true });

		typeFilter(s, "zzz");

		assert.deepEqual(shownEntries(s), []);
		assert.equal(s.el("[data-test-empty]").textContent, "No readlists match");
	});

	it("ignores input outside a readlist filter", () => {
		const s = setup({ overflow: true, finePointer: true });

		s.el("[data-test-plain-input]").dispatchEvent(
			new s.window.Event("input", { bubbles: true }),
		);

		assert.deepEqual(shownEntries(s), ["garden", "work", "cur"]);
	});

	it("follows the first shown entry on Enter in the filter", () => {
		const s = setup({ overflow: true, finePointer: true });
		const followed: string[] = [];
		s.el('[data-test-link="work"]').addEventListener("click", (event) => {
			event.preventDefault();
			followed.push("work");
		});
		typeFilter(s, "work");

		const enter = new s.window.KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		});
		s.el("[data-test-filter]").dispatchEvent(enter);

		assert.deepEqual(followed, ["work"]);
		assert.equal(enter.defaultPrevented, true);
	});

	it("follows nothing on Enter when the filter is empty or nothing matches", () => {
		const s = setup({ overflow: true, finePointer: true });
		const followed: string[] = [];
		for (const link of s.document.querySelectorAll("a")) {
			link.addEventListener("click", (event) => {
				event.preventDefault();
				followed.push("link");
			});
		}
		const enter = () => {
			const event = new s.window.KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			});
			s.el("[data-test-filter]").dispatchEvent(event);
			return event;
		};

		assert.equal(enter().defaultPrevented, true);
		typeFilter(s, "zzz");
		enter();
		s.el("[data-test-filter]").dispatchEvent(
			new s.window.KeyboardEvent("keydown", { key: "a", bubbles: true }),
		);
		s.el("[data-test-plain-input]").dispatchEvent(
			new s.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);

		assert.deepEqual(followed, []);
	});

	it("closes an open switch when focus leaves it for the page", () => {
		const s = setup({ overflow: true, finePointer: true });
		toggle(s, "[data-test-switch]", "open");

		s.el('[data-test-link="work"]').dispatchEvent(
			new s.window.FocusEvent("focusout", {
				bubbles: true,
				relatedTarget: s.el("[data-test-outside]"),
			}),
		);

		assert.deepEqual(s.hidden, ["readlist-more"]);
	});

	it("stays open when focus moves inside it, into another popover, or nowhere", () => {
		const s = setup({ overflow: true, finePointer: true });
		toggle(s, "[data-test-switch]", "open");
		const leave = (relatedTarget: Element | null) =>
			s
				.el('[data-test-link="work"]')
				.dispatchEvent(
					new s.window.FocusEvent("focusout", { bubbles: true, relatedTarget }),
				);

		leave(s.el('[data-test-menu="work"]'));
		leave(s.el("[data-test-other-button]"));
		leave(null);

		assert.deepEqual(s.hidden, []);
	});

	it("ignores focus leaving a closed switch or an element outside any switch", () => {
		const s = setup({ overflow: true, finePointer: true });

		s.el('[data-test-link="work"]').dispatchEvent(
			new s.window.FocusEvent("focusout", {
				bubbles: true,
				relatedTarget: s.el("[data-test-outside]"),
			}),
		);
		s.el("[data-test-outside]").dispatchEvent(
			new s.window.FocusEvent("focusout", {
				bubbles: true,
				relatedTarget: s.el("[data-test-plain-input]"),
			}),
		);

		assert.deepEqual(s.hidden, []);
	});

	function stubRect(
		element: Element,
		rect: { top: number; bottom: number; height: number },
	): void {
		Object.defineProperty(element, "getBoundingClientRect", {
			value: () => rect,
		});
	}

	function openRailMenu(
		s: Setup,
		rects: {
			toggle: { top: number; bottom: number };
			panelHeight: number;
		},
	): HTMLElement {
		const menu = s.el("[data-test-rail-menu]");
		stubRect(menu, {
			...rects.toggle,
			height: rects.toggle.bottom - rects.toggle.top,
		});
		stubRect(s.el("[data-test-rail-menu] .menu__panel"), {
			top: 0,
			bottom: rects.panelHeight,
			height: rects.panelHeight,
		});
		menu.setAttribute("open", "");
		menu.dispatchEvent(new s.window.Event("toggle"));
		return menu;
	}

	it("opens a rail menu upward when its panel would leave the viewport and there is more room above", () => {
		const s = setup({ overflow: true, finePointer: true });
		Object.defineProperty(s.window, "innerHeight", { value: 700 });

		const menu = openRailMenu(s, {
			toggle: { top: 620, bottom: 660 },
			panelHeight: 120,
		});

		assert.ok(menu.classList.contains("readlist-nav__menu--up"));
	});

	it("opens a rail menu downward when its panel fits below", () => {
		const s = setup({ overflow: true, finePointer: true });
		Object.defineProperty(s.window, "innerHeight", { value: 700 });
		s.el("[data-test-rail-menu]").classList.add("readlist-nav__menu--up");

		const menu = openRailMenu(s, {
			toggle: { top: 40, bottom: 80 },
			panelHeight: 120,
		});

		assert.equal(menu.classList.contains("readlist-nav__menu--up"), false);
	});

	it("opens a rail menu downward when there is no more room above than below", () => {
		const s = setup({ overflow: true, finePointer: true });
		Object.defineProperty(s.window, "innerHeight", { value: 100 });

		const menu = openRailMenu(s, {
			toggle: { top: 20, bottom: 60 },
			panelHeight: 120,
		});

		assert.equal(menu.classList.contains("readlist-nav__menu--up"), false);
	});

	it("leaves closing rail menus, menus outside the rail and other toggles alone", () => {
		const s = setup({ overflow: true, finePointer: true });
		s.el("[data-test-rail-menu]").classList.add("readlist-nav__menu--up");
		s.el("[data-test-loose-menu]").classList.add("readlist-nav__menu--up");

		s.el("[data-test-rail-menu]").dispatchEvent(new s.window.Event("toggle"));
		s.el("[data-test-loose-menu]").setAttribute("open", "");
		s.el("[data-test-loose-menu]").dispatchEvent(new s.window.Event("toggle"));
		toggle(s, "[data-test-other-popover]", "open");
		s.document.dispatchEvent(new s.window.Event("toggle"));

		assert.ok(
			s
				.el("[data-test-rail-menu]")
				.classList.contains("readlist-nav__menu--up"),
		);
		assert.ok(
			s
				.el("[data-test-loose-menu]")
				.classList.contains("readlist-nav__menu--up"),
		);
		assert.equal(
			s.el("[data-test-opener]").getAttribute("aria-expanded"),
			null,
		);
	});
});
