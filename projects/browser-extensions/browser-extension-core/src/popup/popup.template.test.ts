import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brandMarkSvg } from "@packages/web-shell";

const template = readFileSync(
	join(__dirname, "..", "..", "src", "popup", "popup-views.template.html"),
	"utf-8",
);

describe("popup brand mark", () => {
	it("login view carries the exact brandMarkSvg output", () => {
		expect(template).toContain(brandMarkSvg({ className: "login__icon" }));
	});

	it("list-view header carries the exact brandMarkSvg output", () => {
		expect(template).toContain(brandMarkSvg({ className: "list-view__brand-icon" }));
	});
});

describe("popup links to Readplace", () => {
	it("leaves each same-origin href for the build to tag with the browser's own source", () => {
		expect(template).toContain('<a href="{{brandHomeHref}}" class="login__logo-link" target="_blank" rel="noopener">');
		expect(template).toContain('<a href="{{openReadlistHref}}" class="list-view__brand" target="_blank" rel="noopener">');
	});
});

describe("sign in", () => {
	it("offers one primary action to sign in", () => {
		expect(template).toContain(
			'<button id="login-button" class="btn btn--primary login__submit" type="button">Sign in to Readplace</button>',
		);
	});

	it("names a failed sign-in without guessing its cause", () => {
		expect(template).toContain(
			[
				'      <div id="login-error" class="popup-alert" role="alert" hidden>',
				'        <span class="popup-alert__icon">{{errorIcon}}</span>',
				'        <div class="popup-alert__text">',
				'          <p class="popup-alert__title">Couldn&rsquo;t sign in</p>',
				'          <p class="popup-alert__body">You&rsquo;re still signed out. Try again.</p>',
				"        </div>",
				"      </div>",
			].join("\n"),
		);
	});

	it("signs out from an icon control named for screen readers", () => {
		expect(template).toContain(
			'<button id="logout-button" class="list-view__signout" type="button" title="Sign out">{{signOutIcon}}<span class="sr-only">Sign out</span></button>',
		);
	});
});

describe("save all tabs progress", () => {
	it("save-all view tells the reader the save survives closing the popup", () => {
		expect(template).toContain(
			'<p id="save-all-hint" class="saved-view__subtitle" data-test-save-all-hint>Saving continues if you close this popup. You&rsquo;ll get a notification when it&rsquo;s done.</p>',
		);
	});

	it("save-all failure claims nothing about which tabs were saved, since some may have been", () => {
		expect(template).toContain(
			'<p class="popup-alert__body">Some tabs may have saved. Check your readlist before trying again.</p>',
		);
	});

	it("save-all view carries the failed-tab list, hidden until a save fails", () => {
		expect(template).toContain(
			'<ul id="save-all-failed" class="save-all-view__failed" data-test-save-all-failed hidden></ul>',
		);
	});
});

describe("save all tabs control", () => {
	it("list-view header carries the save-all-tabs control, counting what it will send and naming its scope for screen readers", () => {
		expect(template).toContain(
			[
				'        <button id="save-all-tabs-button" class="btn btn--neutral btn--compact list-view__save-all" type="button" title="Save all tabs in this window" data-test-save-all-tabs hidden>',
				'          <span class="list-view__save-all-count" data-test-save-all-count>Save tabs</span><span class="sr-only"> in this window</span>',
				"        </button>",
			].join("\n"),
		);
	});
});

describe("filter", () => {
	it("names the filter by what it matches, not by its placeholder alone", () => {
		expect(template).toContain(
			[
				'      <label for="filter-input" class="sr-only">Filter this page by web address</label>',
				"      <input",
				'        type="text"',
				'        id="filter-input"',
				'        class="list-view__filter"',
				'        placeholder="Filter by web address&hellip;"',
				"      >",
			].join("\n"),
		);
	});
});

describe("shortcut hints", () => {
	it("closes the single-save view with the save shortcut, so one save teaches only its own key", () => {
		expect(template).toContain(
			[
				'    <div id="saved-affordances" class="saved-view__affordances"></div>',
				'    <p id="save-shortcut-hint" class="shortcut-hint">Save any page with <kbd class="shortcut-hint__key">Ctrl</kbd>+<kbd class="shortcut-hint__key">D</kbd>.</p>',
				"  </div>",
			].join("\n"),
		);
	});

	it("closes the bulk-save view with the save-all shortcut, hidden until the server advertises bulk save", () => {
		expect(template).toContain(
			[
				'    <button id="save-all-view-readlist" class="btn btn--neutral" type="button" hidden>View readlist</button>',
				'    <p id="save-all-shortcut-hint" class="shortcut-hint" hidden>Save all tabs with <kbd class="shortcut-hint__key">Ctrl</kbd>+<kbd class="shortcut-hint__key">Shift</kbd>+<kbd class="shortcut-hint__key">D</kbd>.</p>',
				"  </div>",
			].join("\n"),
		);
	});

	it("carries each hint exactly once, so neither view teaches the other's key", () => {
		expect(template.split('id="save-shortcut-hint"')).toHaveLength(2);
		expect(template.split('id="save-all-shortcut-hint"')).toHaveLength(2);
	});
});

describe("saving view", () => {
	it("opens on a placeholder of the saved card, announcing the save outside the hidden placeholder", () => {
		expect(template).toContain(
			[
				'    <div id="saving-progress" class="saving-view__skeleton" aria-hidden="true">',
				'      <span class="saving-view__icon"></span>',
				"      <div>",
				'        <p class="saved-view__title"><span class="saving-view__bar saving-view__bar--title"></span></p>',
				'        <p class="saved-view__subtitle"><span class="saving-view__bar saving-view__bar--subtitle"></span></p>',
				"      </div>",
				'      <div class="saved-view__affordances">',
				'        <span class="saving-view__action"><span class="saving-view__bar saving-view__bar--action"></span></span>',
				"      </div>",
				"    </div>",
				'    <p id="saving-status" class="shortcut-hint" role="status"><span class="saving-view__pulse" aria-hidden="true"></span>Saving&hellip;</p>',
			].join("\n"),
		);
	});

	it("paints the save failure in place, with a control that re-runs the save", () => {
		expect(template).toContain(
			[
				'    <div id="save-failure" class="saving-view__failure" hidden>',
				'      <div class="popup-alert" role="alert">',
				'        <span class="popup-alert__icon">{{errorIcon}}</span>',
				'        <div class="popup-alert__text">',
				'          <p class="popup-alert__title">Couldn&rsquo;t save this page</p>',
				'          <p class="popup-alert__body">Nothing was saved.</p>',
				"        </div>",
				"      </div>",
				'      <button id="save-retry-button" class="btn btn--primary" type="button">Try again</button>',
				"    </div>",
			].join("\n"),
		);
	});

	it("carries the saving progress region exactly once", () => {
		expect(template.split('id="saving-progress"')).toHaveLength(2);
	});
});

describe("list states", () => {
	it("tells a reader with nothing left to read that they are caught up", () => {
		expect(template).toContain(
			[
				'    <div id="empty-list" class="list-empty" hidden>',
				'      <p class="list-empty__title">You&rsquo;re all caught up</p>',
				'      <p class="list-empty__body">Save a link and it appears here.</p>',
				"    </div>",
			].join("\n"),
		);
	});

	it("tells a reader whose filter matched nothing where the filter looked", () => {
		expect(template).toContain(
			[
				'    <div id="no-matches" class="list-empty" hidden>',
				'      <p class="list-empty__title">No matching articles</p>',
				'      <p class="list-empty__body">The filter searches this page of your readlist only.</p>',
				"    </div>",
			].join("\n"),
		);
	});

	it("offers a retry beside a failed load, hidden until the popup has something to retry", () => {
		expect(template).toContain(
			[
				'    <div id="list-error" class="popup-alert list-view__alert" role="alert" hidden>',
				'      <span class="popup-alert__icon">{{errorIcon}}</span>',
				'      <div class="popup-alert__text">',
				'        <p id="list-error-title" class="popup-alert__title"></p>',
				'        <p id="list-error-body" class="popup-alert__body"></p>',
				'        <button id="list-error-retry" class="btn btn--neutral btn--compact popup-alert__action" type="button" hidden>Try again</button>',
				"      </div>",
				"    </div>",
			].join("\n"),
		);
	});

	it("labels the pager as navigation", () => {
		expect(template).toContain('<nav id="pagination" class="pagination" aria-label="Pagination" hidden></nav>');
	});
});

describe("list skeleton view", () => {
	it("carries the exact brandMarkSvg output, so the mark never flashes into a bar", () => {
		expect(template).toContain(brandMarkSvg({ className: "list-skeleton__brand-icon" }));
	});

	it("stands in six placeholder rows, matching the list it fills", () => {
		expect(template.split('class="list-skeleton__row"')).toHaveLength(7);
	});
});
