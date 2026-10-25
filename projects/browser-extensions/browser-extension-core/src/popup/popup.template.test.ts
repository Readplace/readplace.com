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
				'      <div id="login-error" class="alert alert--error alert--visible" role="alert" hidden>',
				'        <span class="alert__icon" aria-hidden="true">{{errorIcon}}</span>',
				'        <div class="alert__content">',
				'          <p class="alert__title">Couldn&rsquo;t sign in</p>',
				'          <p class="alert__message">You&rsquo;re still signed out. Try again.</p>',
				"        </div>",
				"      </div>",
			].join("\n"),
		);
	});

	it("sets the two-tone wordmark beside the mark, leaving the link named for screen readers", () => {
		expect(template).toContain(
			[
				'        <span class="login__wordmark" aria-hidden="true">Read<span class="login__wordmark-tail">place</span></span>',
				'        <span class="sr-only">Visit Readplace</span>',
				"      </a>",
			].join("\n"),
		);
	});

	it("signs out from a labelled neutral control", () => {
		expect(template).toContain(
			'<button id="logout-button" class="btn btn--neutral btn--s" type="button">Sign out</button>',
		);
	});
});

describe("save all tabs progress", () => {
	it("save-all view tells the reader the save survives closing the popup", () => {
		expect(template).toContain(
			'<p id="save-all-hint" class="saved-view__subtitle save-all-view__pending" data-test-save-all-hint>Saving continues if you close this popup. You&rsquo;ll get a notification when it&rsquo;s done.</p>',
		);
	});

	it("save-all failure claims nothing about which tabs were saved, since some may have been", () => {
		expect(template).toContain(
			[
				'    <div id="save-all-failure" class="alert alert--error alert--visible" role="alert" hidden>',
				'      <span class="alert__icon" aria-hidden="true">{{errorIcon}}</span>',
				'      <div class="alert__content">',
				'        <p id="save-all-failure-title" class="alert__title"></p>',
				'        <p class="alert__message">Some tabs may have saved. Check your readlist before trying again.</p>',
				"      </div>",
				"    </div>",
			].join("\n"),
		);
	});

	it("save-all view reserves the count line at its widest form, so a moving count never shifts the view", () => {
		expect(template).toContain(
			[
				'      <p id="save-all-count" class="saved-view__subtitle save-all-view__count save-all-view__pending" data-test-save-all-progress-count>',
				'        <span class="save-all-view__count-line"><span class="saving-view__pulse" aria-hidden="true"></span><span id="save-all-count-text"></span></span>',
				'        <span class="save-all-view__count-line save-all-view__count-twin" aria-hidden="true"><span class="saving-view__pulse"></span>Sent 999 of 999 &middot; Sending 999</span>',
				"      </p>",
			].join("\n"),
		);
	});

	it("save-all view offers to continue in the background just above the readlist control", () => {
		expect(template).toContain(
			[
				'    <button id="save-all-continue" class="btn btn--neutral save-all-view__pending" type="button" data-test-save-all-continue>Continue in background</button>',
				'    <button id="save-all-view-readlist" class="btn btn--neutral" type="button" hidden>View readlist</button>',
			].join("\n"),
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
				'        <button id="save-all-tabs-button" class="btn btn--primary btn--s list-view__save-all" type="button" title="Save all tabs in this window" data-test-save-all-tabs hidden>',
				'          <span class="list-view__save-all-count" data-test-save-all-count>Save tabs</span><span class="sr-only"> in this window</span>',
				"        </button>",
			].join("\n"),
		);
	});
});

describe("search", () => {
	it("names the search by what it matches, not by its placeholder alone, inside a search landmark", () => {
		expect(template).toContain(
			[
				'      <div class="list-view__search" role="search">',
				'        <label for="filter-input" class="sr-only">Search this page by title or web address</label>',
				'        <span class="list-view__search-icon" aria-hidden="true">{{searchIcon}}</span>',
				"        <input",
				'          type="text"',
				'          id="filter-input"',
				'          class="list-view__filter"',
				'          placeholder="Search articles or sources&hellip;"',
				"        >",
				"      </div>",
			].join("\n"),
		);
	});
});

describe("count and sort", () => {
	it("holds the server's count and the sort toggle in one row, hidden until a listing names them", () => {
		expect(template).toContain(
			[
				'      <div id="list-header" class="list-view__list-header" hidden>',
				'        <p class="list-view__count" data-test-list-count></p>',
				'        <button id="sort-button" class="list-view__sort" type="button" hidden></button>',
				"      </div>",
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
				'      <div class="alert alert--error alert--visible" role="alert">',
				'        <span class="alert__icon" aria-hidden="true">{{errorIcon}}</span>',
				'        <div class="alert__content">',
				'          <p class="alert__title">Couldn&rsquo;t save this page</p>',
				'          <p class="alert__message">Nothing was saved.</p>',
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
	it("tells a reader with nothing left to read that they are caught up, under the illustration", () => {
		expect(template).toContain(
			[
				'        <div id="empty-list" class="list-empty" hidden>',
				'          <span class="list-view__empty-art" aria-hidden="true">{{emptyArt}}</span>',
				'          <p class="list-empty__title">No unread articles</p>',
				'          <p class="list-empty__body">You&rsquo;re all caught up. Save a new article or open some tabs to add them to your readlist.</p>',
				"        </div>",
			].join("\n"),
		);
	});

	it("tells a reader whose search matched nothing where the search looked", () => {
		expect(template).toContain(
			[
				'        <div id="no-matches" class="list-empty" hidden>',
				'          <p class="list-empty__title">No matching articles</p>',
				'          <p class="list-empty__body">The search covers this page of your readlist only.</p>',
				"        </div>",
			].join("\n"),
		);
	});

	it("offers a retry beside a failed load, hidden until the popup has something to retry", () => {
		expect(template).toContain(
			[
				'      <div id="list-error" class="alert alert--error alert--visible list-view__alert" role="alert" hidden>',
				'        <span class="alert__icon" aria-hidden="true">{{errorIcon}}</span>',
				'        <div class="alert__content">',
				'          <p id="list-error-title" class="alert__title"></p>',
				'          <p id="list-error-body" class="alert__message"></p>',
				'          <button id="list-error-retry" class="btn btn--neutral btn--s list-view__alert-action" type="button" hidden>Try again</button>',
				"        </div>",
				"      </div>",
			].join("\n"),
		);
	});

	it("warns about a page it could not save as a warning alert the popup fills in", () => {
		expect(template).toContain(
			[
				'      <div id="list-warning" class="alert alert--warning alert--visible list-view__alert" role="status" hidden>',
				'        <span class="alert__icon" aria-hidden="true">{{warningIcon}}</span>',
				'        <div class="alert__content">',
				'          <p class="alert__message"></p>',
				"        </div>",
				"      </div>",
			].join("\n"),
		);
	});

	it("labels the pager as navigation, under the list it pages", () => {
		expect(template).toContain(
			[
				'        <div id="link-list" class="list-view__links"></div>',
				'        <nav id="pagination" class="pagination" aria-label="Pagination" hidden></nav>',
			].join("\n"),
		);
	});
});

describe("list skeleton view", () => {
	it("carries the exact brandMarkSvg output, so the mark never flashes into a bar", () => {
		expect(template).toContain(brandMarkSvg({ className: "list-skeleton__brand-icon" }));
	});

	it("stands in five placeholder rows of a title, a fact line and the row action, matching the list it fills", () => {
		const row = [
			'      <div class="list-skeleton__row" aria-hidden="true">',
			'        <span class="list-skeleton__item">',
			'          <span class="list-skeleton__line"><span class="list-skeleton__bar list-skeleton__bar--title"></span></span>',
			'          <span class="list-skeleton__line"><span class="list-skeleton__bar list-skeleton__bar--meta"></span></span>',
			"        </span>",
			'        <span class="list-skeleton__action"></span>',
			"      </div>",
		].join("\n");

		expect(template.split(row)).toHaveLength(6);
		expect(template.split('class="list-skeleton__row"')).toHaveLength(6);
	});
});
