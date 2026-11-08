import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { acceptsFile, classifyFile, formatBytes, initUploadDropzone, type UploadProgress, type UploadRequest } from "./upload-dropzone.client";

const ORIGIN = "https://readplace.com";
const BOOK_ACCEPT = "application/epub+zip,.epub";
const IMPORT_URL = `${ORIGIN}/import?utm_source=test`;
const SIREN = "application/vnd.siren+json";

interface MarkupInput {
	signInHref?: string;
	disabled?: boolean;
	uploadOnChoose?: boolean;
}

function formMarkup(input: MarkupInput = {}): string {
	const signIn = input.signInHref ? ` data-sign-in-href="${input.signInHref}"` : "";
	const disabled = input.disabled ? " disabled" : "";
	const uploadOnChoose = input.uploadOnChoose ?? true;
	return `<form id="form" method="POST" action="/import?utm_source=test" enctype="multipart/form-data"
	data-upload-dropzone data-upload-state="idle" data-test-form="upload-file"
	data-upload-start-action="/upload" data-import-max-bytes="100"${signIn}
	data-upload-on-choose="${uploadOnChoose}"
	data-message-unsupported="Unsupported" data-message-import-too-large="Import too large"
	data-message-failed="Failed">
	<span hidden data-upload-kind="book" data-accept="${BOOK_ACCEPT}" data-max-bytes="1000" data-message-too-large="Book too large"></span>
	<div class="upload-dropzone__idle">
		<label id="zone" data-upload-dropzone-zone>
			<input id="input" type="file" name="file"${disabled}>
			<span id="primary" data-upload-dropzone-primary>Choose a file</span>
			<span id="meta" data-upload-dropzone-meta>HTML, JSON</span>
		</label>
		<p id="error" data-upload-dropzone-error hidden></p>
	</div>
	<div><div id="fill" data-upload-dropzone-progress-fill style="width: 0%"></div><p id="label" data-upload-dropzone-progress-label>Preparing</p></div>
</form>
<form id="other-form" method="POST" action="/elsewhere"><button id="other-submit" type="submit">Go</button></form>
<p id="outside">outside</p>`;
}

interface FakeRequest extends UploadRequest {
	method: string;
	url: string;
	headers: Record<string, string>;
	body: FormData | string | undefined;
	respond(answer: { status: number; responseURL?: string; contentType?: string; body?: string }): void;
	fail(): void;
	progress(event: UploadProgress): void;
}

function fakeRequest(): FakeRequest {
	let responseHeaders: Record<string, string> = {};
	const request: FakeRequest = {
		method: "",
		url: "",
		headers: {},
		body: undefined,
		upload: { onprogress: null },
		onload: null,
		onerror: null,
		status: 0,
		responseURL: "",
		responseText: "",
		open(method, url) {
			request.method = method;
			request.url = url;
		},
		setRequestHeader(name, value) {
			request.headers[name] = value;
		},
		send(body) {
			request.body = body;
		},
		getResponseHeader(name) {
			return responseHeaders[name] ?? null;
		},
		respond(answer) {
			responseHeaders = answer.contentType ? { "Content-Type": answer.contentType } : {};
			Object.assign(request, {
				status: answer.status,
				responseURL: answer.responseURL ?? request.url,
				responseText: answer.body ?? "",
			});
			request.onload?.();
		},
		fail() {
			request.onerror?.();
		},
		progress(event) {
			request.upload.onprogress?.(event);
		},
	};
	return request;
}

function setup(input: MarkupInput = {}) {
	const dom = new JSDOM(`<!doctype html><html><body>${formMarkup(input)}</body></html>`, { url: `${ORIGIN}/import` });
	const document = dom.window.document;
	const requests: FakeRequest[] = [];
	const navigations: string[] = [];
	initUploadDropzone({
		document,
		createRequest: () => {
			const request = fakeRequest();
			requests.push(request);
			return request;
		},
		navigate: (url) => navigations.push(url),
	});
	const byId = (id: string) => {
		const element = document.getElementById(id);
		assert(element, `#${id} must exist`);
		return element;
	};
	const input2 = byId("input");
	assert(input2 instanceof dom.window.HTMLInputElement);
	const choose = (file: File) => {
		Object.defineProperty(input2, "files", { configurable: true, writable: true, value: [file] });
		input2.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
	};
	const file = (parts: string[], name: string, type: string) => new dom.window.File(parts, name, { type });
	return { dom, document, requests, navigations, byId, input: input2, choose, file };
}

describe("classifyFile", () => {
	it.each([
		[{ name: "book.epub", type: "application/epub+zip" }, "upload"],
		[{ name: "BOOK.EPUB", type: "" }, "upload"],
		[{ name: "renamed", type: "application/epub+zip" }, "upload"],
		[{ name: "bookmarks.html", type: "text/html" }, "links"],
		[{ name: "export.json", type: "application/json" }, "links"],
		[{ name: "feed.opml", type: "application/rss+xml" }, "links"],
		[{ name: "data.jsonld", type: "application/ld+json" }, "links"],
		[{ name: "notes", type: "" }, "links"],
		[{ name: "paper.pdf", type: "application/pdf" }, "unsupported"],
		[{ name: "photo.png", type: "image/png" }, "unsupported"],
	])("classifies %o as %s", (file, expected) => {
		expect(classifyFile(file, [BOOK_ACCEPT])).toBe(expected);
	});

	it("routes a file to upload when any offered kind accepts it", () => {
		expect(classifyFile({ name: "talk.mp3", type: "audio/mpeg" }, [BOOK_ACCEPT, "audio/mpeg,.mp3"])).toBe("upload");
	});

	it("leaves a type no kind is offered for to the link import or refuses it", () => {
		expect(classifyFile({ name: "book.epub", type: "" }, [])).toBe("links");
		expect(classifyFile({ name: "talk.mp3", type: "audio/mpeg" }, [BOOK_ACCEPT])).toBe("unsupported");
	});
});

describe("acceptsFile", () => {
	it("matches an accept list's types exactly and its extensions case-blind", () => {
		expect(acceptsFile({ name: "a.EPUB", type: "" }, " .Epub ,application/epub+zip")).toBe(true);
		expect(acceptsFile({ name: "a", type: "application/epub+zip" }, BOOK_ACCEPT)).toBe(true);
		expect(acceptsFile({ name: "a.epub.txt", type: "text/plain" }, BOOK_ACCEPT)).toBe(false);
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

describe("initUploadDropzone", () => {
	it("refuses to start outside a window", () => {
		const { document } = new JSDOM("").window;
		const detached = document.implementation.createHTMLDocument("");
		expect(() => initUploadDropzone({ document: detached, createRequest: fakeRequest, navigate: () => {} })).toThrow(
			"the upload dropzone must live in a window",
		);
	});

	it("tints the zone while a file is held over it and clears it when the file leaves", () => {
		const { dom, byId } = setup();
		const zone = byId("zone");
		const enter = new dom.window.Event("dragenter", { bubbles: true, cancelable: true });

		zone.dispatchEvent(enter);
		expect(zone.classList.contains("upload-dropzone--dragover")).toBe(true);
		expect(enter.defaultPrevented).toBe(true);
		zone.dispatchEvent(new dom.window.Event("dragleave", { bubbles: true }));
		expect(zone.classList.contains("upload-dropzone--dragover")).toBe(false);
		zone.dispatchEvent(new dom.window.Event("dragover", { bubbles: true, cancelable: true }));
		expect(zone.classList.contains("upload-dropzone--dragover")).toBe(true);
		zone.dispatchEvent(new dom.window.Event("dragend", { bubbles: true }));
		expect(zone.classList.contains("upload-dropzone--dragover")).toBe(false);
	});

	it("leaves drags and drops outside a dropzone alone", () => {
		const { dom, byId, requests } = setup();
		const outside = byId("outside");
		const enter = new dom.window.Event("dragenter", { bubbles: true, cancelable: true });
		outside.dispatchEvent(enter);
		outside.dispatchEvent(new dom.window.Event("dragleave", { bubbles: true }));
		const drop = new dom.window.Event("drop", { bubbles: true, cancelable: true });
		outside.dispatchEvent(drop);
		dom.window.document.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

		expect(enter.defaultPrevented).toBe(false);
		expect(drop.defaultPrevented).toBe(false);
		expect(requests).toEqual([]);
	});

	it("ignores drags and files on a disabled input", () => {
		const { dom, byId, choose, file, requests } = setup({ disabled: true });
		const zone = byId("zone");
		const enter = new dom.window.Event("dragenter", { bubbles: true, cancelable: true });
		zone.dispatchEvent(enter);
		choose(file(["https://a.example"], "links.txt", "text/plain"));

		expect(enter.defaultPrevented).toBe(false);
		expect(zone.classList.contains("upload-dropzone--dragover")).toBe(false);
		expect(requests).toEqual([]);
		expect(byId("meta").textContent).toBe("HTML, JSON");
	});

	it("hands a dropped file to the input and uploads it", () => {
		const { dom, byId, input, file, requests } = setup();
		const zone = byId("zone");
		Object.defineProperty(input, "files", { configurable: true, writable: true, value: [] });
		zone.classList.add("upload-dropzone--dragover");
		const dropped = [file(["https://a.example"], "links.txt", "text/plain")];
		const drop = new dom.window.Event("drop", { bubbles: true, cancelable: true });
		Object.defineProperty(drop, "dataTransfer", { value: { files: dropped } });

		zone.dispatchEvent(drop);

		expect(drop.defaultPrevented).toBe(true);
		expect(zone.classList.contains("upload-dropzone--dragover")).toBe(false);
		expect(input.files).toBe(dropped);
		expect(requests.map((request) => request.url)).toEqual([IMPORT_URL]);
	});

	it("does nothing with a drop that carries no files", () => {
		const { dom, byId, requests } = setup();
		const empty = new dom.window.Event("drop", { bubbles: true, cancelable: true });
		Object.defineProperty(empty, "dataTransfer", { value: { files: [] } });
		byId("zone").dispatchEvent(empty);
		byId("zone").dispatchEvent(new dom.window.Event("drop", { bubbles: true, cancelable: true }));

		expect(requests).toEqual([]);
	});

	it("does nothing when the picker closes without a file", () => {
		const { dom, input, requests } = setup();
		Object.defineProperty(input, "files", { configurable: true, value: [] });
		input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

		expect(requests).toEqual([]);
	});

	it("shows the file name and refuses a type it cannot read", () => {
		const { byId, choose, file, input, requests, document } = setup();
		choose(file(["%PDF"], "paper.pdf", "application/pdf"));

		expect(byId("meta").textContent).toBe("paper.pdf");
		expect(byId("error").textContent).toBe("Unsupported");
		expect(byId("error").hidden).toBe(false);
		expect(input.getAttribute("aria-invalid")).toBe("true");
		expect(document.getElementById("form")?.getAttribute("data-upload-state")).toBe("idle");
		expect(requests).toEqual([]);
	});

	it("clears an earlier error when the next file is chosen", () => {
		const { byId, choose, file, input } = setup();
		choose(file(["%PDF"], "paper.pdf", "application/pdf"));
		choose(file(["https://a.example"], "links.txt", "text/plain"));

		expect(byId("error").textContent).toBe("");
		expect(byId("error").hidden).toBe(true);
		expect(input.hasAttribute("aria-invalid")).toBe(false);
	});

	it("refuses a link export over the import cap", () => {
		const { byId, choose, file, requests } = setup();
		choose(file(["x".repeat(101)], "links.txt", "text/plain"));

		expect(byId("error").textContent).toBe("Import too large");
		expect(requests).toEqual([]);
	});

	it("refuses a book over the book cap", () => {
		const { byId, choose, file, requests } = setup();
		choose(file(["x".repeat(1001)], "book.epub", "application/epub+zip"));

		expect(byId("error").textContent).toBe("Book too large");
		expect(requests).toEqual([]);
	});

	it("sends a signed-out reader with a book to sign up without a request", () => {
		const { choose, file, requests, navigations } = setup({ signInHref: "/signup?return=%2Fupload" });
		choose(file(["PK"], "book.epub", "application/epub+zip"));

		expect(navigations).toEqual(["/signup?return=%2Fupload"]);
		expect(requests).toEqual([]);
	});

	it("posts a link export as multipart, shows its progress and follows the review redirect", () => {
		const { choose, file, requests, navigations, byId, document } = setup();
		const links = file(["https://a.example"], "links.txt", "text/plain");
		choose(links);

		const [request] = requests;
		expect(document.getElementById("form")?.getAttribute("data-upload-state")).toBe("uploading");
		expect(request.method).toBe("POST");
		expect(request.headers.Accept).toBe(`${SIREN}, text/html;q=0.9`);
		const body = request.body;
		assert(typeof body !== "string" && body !== undefined);
		expect(body.get("file")).toBeTruthy();

		request.progress({ loaded: 50, total: 0, lengthComputable: false });
		expect(byId("label").textContent).toBe("Preparing");
		request.progress({ loaded: 512, total: 1024, lengthComputable: true });
		expect(byId("fill").style.width).toBe("50%");
		expect(byId("label").textContent).toBe("Uploading 1 KB of 1 KB (50%)");

		request.respond({ status: 200, responseURL: `${ORIGIN}/import/abc`, contentType: "text/html" });
		expect(navigations).toEqual([`${ORIGIN}/import/abc`]);
	});

	it("shows a Siren refusal inline and goes back to idle", () => {
		const { choose, file, requests, byId, document, navigations } = setup();
		choose(file(["nothing"], "links.txt", "text/plain"));

		requests[0].respond({
			status: 422,
			contentType: SIREN,
			body: JSON.stringify({ class: ["error"], properties: { code: "import_no_urls", message: "No links" } }),
		});

		expect(byId("error").textContent).toBe("No links");
		expect(document.getElementById("form")?.getAttribute("data-upload-state")).toBe("idle");
		expect(navigations).toEqual([]);
	});

	it.each([
		["a body that is not JSON", "<html>oops</html>"],
		["a body that is not an object", "null"],
		["a class that is not a list", JSON.stringify({ class: "error" })],
		["a class with a name that is not text", JSON.stringify({ class: [1] })],
	])("reports a Siren answer with %s as a failed upload", (_label, body) => {
		const { choose, file, requests, byId } = setup();
		choose(file(["https://a.example"], "links.txt", "text/plain"));

		requests[0].respond({ status: 422, contentType: SIREN, body });

		expect(byId("error").textContent).toBe("Failed");
	});

	it("names a Siren refusal whose properties are not an object a bug", () => {
		const { choose, file, requests } = setup();
		choose(file(["nothing"], "links.txt", "text/plain"));

		expect(() =>
			requests[0].respond({ status: 422, contentType: SIREN, body: JSON.stringify({ class: ["error"], properties: "No links" }) }),
		).toThrow("a Siren error must carry its message");
	});

	it("names a Siren refusal without its message a bug", () => {
		const { choose, file, requests } = setup();
		choose(file(["nothing"], "links.txt", "text/plain"));

		expect(() => requests[0].respond({ status: 422, contentType: SIREN, body: JSON.stringify({ class: ["error"] }) })).toThrow(
			"a Siren error must carry its message",
		);
	});

	it.each([
		["a network error", (request: FakeRequest) => request.fail()],
		["an answer that neither redirects nor speaks Siren", (request: FakeRequest) => request.respond({ status: 500, contentType: "text/html" })],
		["a Siren entity that answered an error status", (request: FakeRequest) => request.respond({ status: 500, contentType: SIREN, body: JSON.stringify({ class: ["upload-staged"] }) })],
		["a Siren entity where a redirect was due", (request: FakeRequest) => request.respond({ status: 200, contentType: SIREN, body: JSON.stringify({ class: ["upload-staged"] }) })],
	])("reports %s on a link export as a failed upload", (_label, answer) => {
		const { choose, file, requests, byId } = setup();
		choose(file(["https://a.example"], "links.txt", "text/plain"));

		answer(requests[0]);

		expect(byId("error").textContent).toBe("Failed");
	});

	function stagedEntity() {
		return JSON.stringify({
			class: ["upload-staged"],
			actions: [
				{
					name: "upload-content",
					href: "https://media.s3.amazonaws.com/",
					method: "POST",
					type: "multipart/form-data",
					fields: [
						{ name: "key", type: "hidden", value: "staged/abc" },
						{ name: "policy", type: "hidden", value: "p" },
						{ name: "file", type: "file" },
					],
				},
				{ name: "confirm-received", href: "/upload/abc/received", method: "POST" },
			],
		});
	}

	function startBook() {
		const harness = setup();
		harness.choose(harness.file(["PK"], "book.epub", ""));
		return harness;
	}

	it("starts a book on /upload, posts it to storage with the file last, confirms it and follows the queue redirect", () => {
		const { requests, navigations, byId } = startBook();

		const [start] = requests;
		expect(start.url).toBe(`${ORIGIN}/upload`);
		expect(start.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
		expect(new URLSearchParams(String(start.body)).toString()).toBe("fileName=book.epub&byteLength=2");
		start.respond({ status: 200, contentType: SIREN, body: stagedEntity() });

		const storage = requests[1];
		expect(storage.url).toBe("https://media.s3.amazonaws.com/");
		const body = storage.body;
		assert(typeof body !== "string" && body !== undefined);
		expect([...body.keys()]).toEqual(["key", "policy", "file"]);
		storage.progress({ loaded: 1, total: 2, lengthComputable: true });
		expect(byId("label").textContent).toBe("Uploading 0 KB of 0 KB (50%)");
		storage.respond({ status: 201 });

		const confirm = requests[2];
		expect(confirm.url).toBe(`${ORIGIN}/upload/abc/received`);
		expect(confirm.method).toBe("POST");
		confirm.respond({ status: 200, responseURL: `${ORIGIN}/queue`, contentType: "text/html" });

		expect(navigations).toEqual([`${ORIGIN}/queue`]);
	});

	it("reports storage refusing the book as a failed upload", () => {
		const { requests, byId } = startBook();
		requests[0].respond({ status: 200, contentType: SIREN, body: stagedEntity() });
		requests[1].respond({ status: 403 });

		expect(requests).toHaveLength(2);
		expect(byId("error").textContent).toBe("Failed");
	});

	it.each([
		["start", 0],
		["storage", 1],
		["confirmation", 2],
	])("reports a network error at the %s step as a failed upload", (_label, step) => {
		const { requests, byId } = startBook();
		if (step > 0) requests[0].respond({ status: 200, contentType: SIREN, body: stagedEntity() });
		if (step > 1) requests[1].respond({ status: 201 });
		requests[step].fail();

		expect(byId("error").textContent).toBe("Failed");
	});

	it("reports a confirmation that does not redirect as a failed upload", () => {
		const { requests, byId } = startBook();
		requests[0].respond({ status: 200, contentType: SIREN, body: stagedEntity() });
		requests[1].respond({ status: 201 });
		requests[2].respond({ status: 200, contentType: SIREN, body: JSON.stringify({ class: ["upload-staged"] }) });

		expect(byId("error").textContent).toBe("Failed");
	});

	it("skips malformed actions and fields in a staged entity", () => {
		const { requests } = startBook();
		requests[0].respond({
			status: 200,
			contentType: SIREN,
			body: JSON.stringify({
				class: ["upload-staged"],
				actions: [
					"junk",
					{ name: "upload-content" },
					{
						name: "upload-content",
						href: "https://media.s3.amazonaws.com/",
						fields: ["junk", { value: "nameless" }, { name: "key", type: "hidden", value: "staged/abc" }, { name: "file", type: "file" }],
					},
					{ name: "confirm-received", href: "/upload/abc/received" },
				],
			}),
		});

		const body = requests[1].body;
		assert(typeof body !== "string" && body !== undefined);
		expect([...body.entries()].map(([name, value]) => [name, typeof value === "string" ? value : "file"])).toEqual([
			["key", "staged/abc"],
			["file", "file"],
		]);
	});

	it("names an upload action without its presigned fields a bug", () => {
		const { requests } = startBook();

		expect(() =>
			requests[0].respond({
				status: 200,
				contentType: SIREN,
				body: JSON.stringify({
					class: ["upload-staged"],
					actions: [
						{ name: "upload-content", href: "https://media.s3.amazonaws.com/" },
						{ name: "confirm-received", href: "/upload/abc/received" },
					],
				}),
			}),
		).toThrow("the upload-content action must name the presigned fields");
	});

	it("restarts the book flow when the form is submitted after a failed upload, without a native submit", () => {
		const { dom, requests, byId } = startBook();
		requests[0].fail();
		expect(byId("error").textContent).toBe("Failed");

		const submit = new dom.window.Event("submit", { bubbles: true, cancelable: true });
		byId("form").dispatchEvent(submit);

		expect(submit.defaultPrevented).toBe(true);
		expect(requests).toHaveLength(2);
		expect(requests[1].url).toBe(`${ORIGIN}/upload`);
		expect(byId("error").hidden).toBe(true);
	});

	it("does nothing when the form is submitted with no file chosen", () => {
		const { dom, requests, byId } = setup();

		const submit = new dom.window.Event("submit", { bubbles: true, cancelable: true });
		byId("form").dispatchEvent(submit);

		expect(submit.defaultPrevented).toBe(true);
		expect(requests).toHaveLength(0);
	});

	it("leaves other forms' submits alone", () => {
		const { dom, requests, byId } = setup();

		const submit = new dom.window.Event("submit", { bubbles: true, cancelable: true });
		byId("other-form").dispatchEvent(submit);

		expect(submit.defaultPrevented).toBe(false);
		expect(requests).toHaveLength(0);
	});

	it("reports a staged entity missing its actions as a failed upload", () => {
		const { requests, byId } = startBook();
		requests[0].respond({ status: 200, contentType: SIREN, body: JSON.stringify({ class: ["upload-staged"] }) });

		expect(requests).toHaveLength(1);
		expect(byId("error").textContent).toBe("Failed");
	});

	it("shows a Siren refusal of the book start inline", () => {
		const { requests, byId } = startBook();
		requests[0].respond({
			status: 413,
			contentType: SIREN,
			body: JSON.stringify({ class: ["error"], properties: { code: "upload_too_large", message: "Too big" } }),
		});

		expect(byId("error").textContent).toBe("Too big");
	});
});

describe("initUploadDropzone when choosing a file waits for Send", () => {
	it("keeps a chosen file in the input, names it and clears an earlier error, without uploading", () => {
		const { byId, choose, file, input, requests } = setup({ uploadOnChoose: false });
		byId("error").textContent = "Earlier";
		byId("error").hidden = false;
		input.setAttribute("aria-invalid", "true");

		choose(file(["PK"], "book.epub", "application/epub+zip"));

		expect(byId("primary").textContent).toBe("book.epub");
		expect(byId("error").hidden).toBe(true);
		expect(input.hasAttribute("aria-invalid")).toBe(false);
		expect(requests).toEqual([]);
	});

	it("keeps a dropped file in the input without uploading", () => {
		const { dom, byId, input, file, requests } = setup({ uploadOnChoose: false });
		Object.defineProperty(input, "files", { configurable: true, writable: true, value: [] });
		const dropped = [file(["https://a.example"], "links.txt", "text/plain")];
		const drop = new dom.window.Event("drop", { bubbles: true, cancelable: true });
		Object.defineProperty(drop, "dataTransfer", { value: { files: dropped } });

		byId("zone").dispatchEvent(drop);

		expect(input.files).toBe(dropped);
		expect(byId("primary").textContent).toBe("links.txt");
		expect(requests).toEqual([]);
	});

	it("leaves the dropzone alone when the picker closes without a file or the input is disabled", () => {
		const { dom, byId, input, requests } = setup({ uploadOnChoose: false, disabled: true });
		Object.defineProperty(input, "files", { configurable: true, value: [] });
		input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
		Object.defineProperty(input, "files", { configurable: true, value: [new dom.window.File(["x"], "a.txt")] });
		input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

		expect(byId("primary").textContent).toBe("Choose a file");
		expect(requests).toEqual([]);
	});

	it("uploads the kept file when the form is submitted", () => {
		const { dom, choose, file, requests, document } = setup({ uploadOnChoose: false });
		choose(file(["https://a.example"], "links.txt", "text/plain"));
		const form = document.getElementById("form");
		assert(form);

		form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));

		expect(requests.map((request) => request.url)).toEqual([IMPORT_URL]);
	});
});
