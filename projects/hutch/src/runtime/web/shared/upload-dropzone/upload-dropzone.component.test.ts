import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
	renderUploadDropzone,
	UPLOAD_DROPZONE_SCRIPT,
	UPLOAD_DROPZONE_STYLES,
	type UploadDropzoneInput,
} from "./upload-dropzone.component";

const BASE_INPUT: UploadDropzoneInput = {
	importAction: "/import?utm_source=test",
	bookFallbackHref: "/upload?utm_source=test",
	disabled: false,
	idPrefix: "test",
};

function renderForm(overrides: Partial<UploadDropzoneInput> = {}) {
	const { document } = parseHTML(`<!doctype html><html><body>${renderUploadDropzone({ ...BASE_INPUT, ...overrides })}</body></html>`);
	const form = document.querySelector("form[data-upload-dropzone]");
	assert(form, "the dropzone must render its form");
	return { document, form };
}

describe("renderUploadDropzone", () => {
	it("posts the file to the import action as multipart without htmx", () => {
		const { form } = renderForm();

		expect(form.getAttribute("action")).toBe("/import?utm_source=test");
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("enctype")).toBe("multipart/form-data");
		expect(form.getAttribute("data-upload-state")).toBe("idle");
		expect(form.getAttribute("data-test-form")).toBe("upload-file");
		expect(Array.from(form.attributes).filter((attribute) => attribute.name.startsWith("hx-"))).toEqual([]);
	});

	it("names the file input after the id prefix", () => {
		const { form } = renderForm({ idPrefix: "add-article" });

		const input = form.querySelector('input[type="file"]');
		assert(input, "the dropzone must render a file input");
		expect(input.getAttribute("id")).toBe("add-article-file");
		expect(input.getAttribute("name")).toBe("file");
		expect(input.hasAttribute("required")).toBe(true);
	});

	it("names the formats and both caps", () => {
		const { form } = renderForm();

		const meta = form.querySelector("[data-upload-dropzone-meta]");
		assert(meta, "the dropzone must name the formats and caps");
		expect(meta.textContent).toBe(
			"HTML, JSON, or plain text · Max 4.5 MB · Up to 2,000 links · or a DRM-free EPUB up to 200 MB",
		);
	});

	it("hands the client the book types, the starting action and both byte caps", () => {
		const { form } = renderForm();

		expect(form.getAttribute("data-book-accept")).toBe("application/epub+zip:.epub");
		expect(form.getAttribute("data-book-start-action")).toBe("/upload");
		expect(form.getAttribute("data-book-max-bytes")).toBe(String(200 * 1024 * 1024));
		expect(Number(form.getAttribute("data-import-max-bytes"))).toBeGreaterThan(0);
	});

	it("tells a reader with a file over the import cap to split the export", () => {
		const { form } = renderForm();

		expect(form.getAttribute("data-message-import-too-large")).toContain(
			"split the export into smaller files and import them one at a time",
		);
		expect(form.getAttribute("data-message-book-too-large")).toBe("That book is too large. The limit is 200 MB.");
		expect(form.getAttribute("data-message-unsupported")).toContain("isn't supported");
		expect(form.getAttribute("data-message-failed")).toBe("The upload didn't go through. Try again.");
	});

	it("disables the input and the submit for a read-only reader", () => {
		const { form } = renderForm({ disabled: true });

		expect(form.querySelector('input[type="file"]')?.hasAttribute("disabled")).toBe(true);
		expect(form.querySelector('[data-test-action="upload-file"]')?.hasAttribute("disabled")).toBe(true);
	});

	it("leaves the input and the submit enabled otherwise", () => {
		const { form } = renderForm();

		expect(form.querySelector('input[type="file"]')?.hasAttribute("disabled")).toBe(false);
		expect(form.querySelector('[data-test-action="upload-file"]')?.hasAttribute("disabled")).toBe(false);
	});

	it("carries the sign-in href only when one is given", () => {
		expect(renderForm().form.hasAttribute("data-sign-in-href")).toBe(false);
		expect(renderForm({ signInHref: "/signup?return=%2Fupload" }).form.getAttribute("data-sign-in-href")).toBe(
			"/signup?return=%2Fupload",
		);
	});

	it("links a reader without script to the book upload page", () => {
		const { form } = renderForm();

		const noscript = form.querySelector("noscript");
		assert(noscript, "the dropzone must carry a no-script fallback");
		expect(noscript.innerHTML).toContain('href="/upload?utm_source=test"');
	});

	it("ships the dragover state and the client bundle alongside the markup", () => {
		expect(UPLOAD_DROPZONE_STYLES).toContain(".upload-dropzone--dragover");
		expect(UPLOAD_DROPZONE_SCRIPT).toBe('<script src="/client-dist/upload-dropzone.client.js" defer></script>');
	});
});
