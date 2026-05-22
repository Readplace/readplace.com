import { JSDOM } from "jsdom";
import {
	applyIndeterminate,
	formatBytes,
	initIndeterminateCheckboxes,
	initUploadProgress,
} from "./import.client";

function makeDoc(html: string): Document {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

const UPLOAD_FORM_HTML = `
<form class="import__upload-form" method="POST" action="/import" enctype="multipart/form-data"
      data-import-state="idle" hx-post="/import">
  <div class="import__idle" data-import-region="idle">
    <input type="file" name="file" required>
    <button type="submit">Upload</button>
  </div>
  <div class="import__uploading" data-import-region="uploading">
    <div class="import__progress-bar" data-import-progress-bar>
      <div class="import__progress-fill" data-import-progress-fill style="width: 0%"></div>
    </div>
    <p class="import__progress-label" data-import-progress-label>Preparing upload&hellip;</p>
  </div>
</form>
`;

describe("applyIndeterminate", () => {
	it("sets the indeterminate property on every checkbox carrying the marker", () => {
		const doc = makeDoc(
			'<input type="checkbox" data-import-indeterminate id="a">' +
				'<input type="checkbox" data-import-indeterminate id="b">' +
				'<input type="checkbox" id="c">',
		);

		const matched = applyIndeterminate(doc);

		expect(matched).toBe(2);
		expect(doc.querySelector<HTMLInputElement>("#a")?.indeterminate).toBe(true);
		expect(doc.querySelector<HTMLInputElement>("#b")?.indeterminate).toBe(true);
		expect(doc.querySelector<HTMLInputElement>("#c")?.indeterminate).toBe(false);
	});

	it("returns 0 when no checkbox carries the marker", () => {
		const doc = makeDoc('<input type="checkbox" id="a">');

		expect(applyIndeterminate(doc)).toBe(0);
	});
});

describe("initIndeterminateCheckboxes", () => {
	it("applies indeterminate on initial run and on every swap notification", () => {
		const doc = makeDoc('<input type="checkbox" data-import-indeterminate id="a">');
		let registered: (() => void) | undefined;

		initIndeterminateCheckboxes({
			document: doc,
			addSwapListener: (listener) => {
				registered = listener;
			},
		});

		const target = doc.querySelector<HTMLInputElement>("#a");
		expect(target?.indeterminate).toBe(true);

		// Reset to false then re-run via the swap listener and confirm it re-applies.
		if (target) target.indeterminate = false;
		registered?.();
		expect(target?.indeterminate).toBe(true);
	});
});

describe("formatBytes", () => {
	it.each([
		[0, "0 KB"],
		[1024, "1 KB"],
		[10 * 1024, "10 KB"],
		[600_000, "0.6 MB"],
		[1_500_000, "1.4 MB"],
		[3 * 1024 * 1024, "3.0 MB"],
	])("formats %i bytes as %s", (bytes, expected) => {
		expect(formatBytes(bytes)).toBe(expected);
	});

	it("clamps a negative byte count to 0 KB", () => {
		expect(formatBytes(-1)).toBe("0 KB");
	});

	it("clamps a NaN byte count to 0 KB", () => {
		expect(formatBytes(Number.NaN)).toBe("0 KB");
	});
});

describe("initUploadProgress", () => {
	function makeUploadDom(): JSDOM {
		return new JSDOM(`<!doctype html><html><body>${UPLOAD_FORM_HTML}</body></html>`);
	}

	function dispatch(dom: JSDOM, form: HTMLFormElement, type: string, detail?: object | null): void {
		form.dispatchEvent(new dom.window.CustomEvent(type, { detail }));
	}

	it("is a no-op when no .import__upload-form is present", () => {
		const doc = makeDoc('<main>no form here</main>');
		expect(() =>
			initUploadProgress({
				document: doc,
				formatBytes,
				nativeSubmit: () => undefined,
			}),
		).not.toThrow();
	});

	it("flips data-import-state to uploading on htmx:beforeRequest", () => {
		const dom = makeUploadDom();
		const doc = dom.window.document;
		initUploadProgress({ document: doc, formatBytes, nativeSubmit: () => undefined });
		const form = doc.querySelector<HTMLFormElement>("form.import__upload-form");
		if (!form) throw new Error("form must be present");

		expect(form.dataset.importState).toBe("idle");
		dispatch(dom, form, "htmx:beforeRequest");
		expect(form.dataset.importState).toBe("uploading");
	});

	it("updates the progress fill width and label on htmx:xhr:progress", () => {
		const dom = makeUploadDom();
		const doc = dom.window.document;
		initUploadProgress({ document: doc, formatBytes, nativeSubmit: () => undefined });
		const form = doc.querySelector<HTMLFormElement>("form.import__upload-form");
		if (!form) throw new Error("form must be present");

		dispatch(dom, form, "htmx:beforeRequest");
		dispatch(dom, form, "htmx:xhr:progress", { loaded: 600_000, total: 1_500_000 });

		const fill = doc.querySelector<HTMLElement>("[data-import-progress-fill]");
		const label = doc.querySelector<HTMLElement>("[data-import-progress-label]");
		expect(fill?.style.width).toBe("40%");
		expect(label?.textContent).toBe("Uploading 0.6 MB of 1.4 MB (40%)");
	});

	it("ignores a progress event with no total", () => {
		const dom = makeUploadDom();
		const doc = dom.window.document;
		initUploadProgress({ document: doc, formatBytes, nativeSubmit: () => undefined });
		const form = doc.querySelector<HTMLFormElement>("form.import__upload-form");
		if (!form) throw new Error("form must be present");

		dispatch(dom, form, "htmx:xhr:progress", { loaded: 100 });

		const fill = doc.querySelector<HTMLElement>("[data-import-progress-fill]");
		const label = doc.querySelector<HTMLElement>("[data-import-progress-label]");
		expect(fill?.style.width).toBe("0%");
		expect(label?.textContent).toBe("Preparing upload…");
	});

	it("ignores a non-CustomEvent progress event with no detail", () => {
		const dom = makeUploadDom();
		const doc = dom.window.document;
		initUploadProgress({ document: doc, formatBytes, nativeSubmit: () => undefined });
		const form = doc.querySelector<HTMLFormElement>("form.import__upload-form");
		if (!form) throw new Error("form must be present");

		form.dispatchEvent(new dom.window.Event("htmx:xhr:progress"));

		const fill = doc.querySelector<HTMLElement>("[data-import-progress-fill]");
		expect(fill?.style.width).toBe("0%");
	});

	it("ignores a progress event whose detail is null", () => {
		const dom = makeUploadDom();
		const doc = dom.window.document;
		initUploadProgress({ document: doc, formatBytes, nativeSubmit: () => undefined });
		const form = doc.querySelector<HTMLFormElement>("form.import__upload-form");
		if (!form) throw new Error("form must be present");

		dispatch(dom, form, "htmx:xhr:progress", null);

		const fill = doc.querySelector<HTMLElement>("[data-import-progress-fill]");
		expect(fill?.style.width).toBe("0%");
	});

	it.each([
		["htmx:sendError"],
		["htmx:responseError"],
		["htmx:timeout"],
		["htmx:swapError"],
	])("reverts to idle and falls back to native submit on %s", (eventType) => {
		const dom = makeUploadDom();
		const doc = dom.window.document;
		const calls: HTMLFormElement[] = [];
		const removedHxPostBeforeSubmit: boolean[] = [];
		initUploadProgress({
			document: doc,
			formatBytes,
			nativeSubmit: (form) => {
				removedHxPostBeforeSubmit.push(!form.hasAttribute("hx-post"));
				calls.push(form);
			},
		});
		const form = doc.querySelector<HTMLFormElement>("form.import__upload-form");
		if (!form) throw new Error("form must be present");
		dispatch(dom, form, "htmx:beforeRequest");
		expect(form.dataset.importState).toBe("uploading");

		dispatch(dom, form, eventType);

		expect(form.dataset.importState).toBe("idle");
		expect(form.hasAttribute("hx-post")).toBe(false);
		expect(calls).toEqual([form]);
		expect(removedHxPostBeforeSubmit).toEqual([true]);
	});
});
