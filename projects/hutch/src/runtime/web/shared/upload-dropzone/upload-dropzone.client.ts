const SIREN_MEDIA_TYPE = "application/vnd.siren+json";
const SIREN_ACCEPT = `${SIREN_MEDIA_TYPE}, text/html;q=0.9`;

export type FileKind = "book" | "links" | "unsupported";

interface BookAcceptEntry {
	readonly type: string;
	readonly extensions: readonly string[];
}

function parseBookAccept(bookAccept: string): BookAcceptEntry[] {
	return bookAccept
		.split(";")
		.filter((entry) => entry.includes(":"))
		.map((entry) => {
			const [type, extensions] = entry.split(":");
			return { type, extensions: extensions.split(",").map((extension) => extension.toLowerCase()) };
		});
}

function isTextShaped(type: string): boolean {
	return type.startsWith("text/") || type === "application/json" || type.endsWith("+xml") || type.endsWith("+json");
}

export function classifyFile(file: { name: string; type: string }, bookAccept: string): FileKind {
	const name = file.name.toLowerCase();
	const books = parseBookAccept(bookAccept);
	if (books.some((book) => book.type === file.type || book.extensions.some((extension) => name.endsWith(extension)))) {
		return "book";
	}
	if (file.type === "" || isTextShaped(file.type)) return "links";
	return "unsupported";
}

export function formatBytes(bytes: number): string {
	const clamped = bytes > 0 ? bytes : 0;
	const mb = clamped / (1024 * 1024);
	if (mb < 0.1) {
		const kb = Math.round(clamped / 1024);
		return `${kb} KB`;
	}
	const rounded = Math.round(mb * 10) / 10;
	return `${rounded.toFixed(1)} MB`;
}

export interface UploadProgress {
	readonly loaded: number;
	readonly total: number;
	readonly lengthComputable: boolean;
}

export interface UploadRequest {
	open(method: string, url: string): void;
	setRequestHeader(name: string, value: string): void;
	send(body: FormData | string): void;
	getResponseHeader(name: string): string | null;
	readonly upload: { onprogress: ((event: UploadProgress) => void) | null };
	onload: (() => void) | null;
	onerror: (() => void) | null;
	readonly status: number;
	readonly responseURL: string;
	readonly responseText: string;
}

interface UploadDropzoneDeps {
	document: Document;
	createRequest: () => UploadRequest;
	navigate: (url: string) => void;
}

interface SirenField {
	readonly name: string;
	readonly value?: string;
	readonly type?: string;
}

interface SirenAction {
	readonly name: string;
	readonly href: string;
	readonly fields?: readonly SirenField[];
}

interface SirenEntity {
	readonly class: readonly string[];
	readonly message?: string;
	readonly actions: readonly SirenAction[];
}

type Answer =
	| { kind: "navigate"; url: string }
	| { kind: "refused"; message: string }
	| { kind: "entity"; entity: SirenEntity }
	| { kind: "failed" };

function assert(cond: unknown, message: string): asserts cond {
	if (!cond) throw new Error(message);
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is object {
	return typeof value === "object" && value !== null;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function toField(value: unknown): SirenField[] {
	if (!isRecord(value)) return [];
	const name: unknown = Reflect.get(value, "name");
	if (typeof name !== "string") return [];
	return [{ name, value: optionalString(Reflect.get(value, "value")), type: optionalString(Reflect.get(value, "type")) }];
}

function toAction(value: unknown): SirenAction[] {
	if (!isRecord(value)) return [];
	const name: unknown = Reflect.get(value, "name");
	const href: unknown = Reflect.get(value, "href");
	if (typeof name !== "string" || typeof href !== "string") return [];
	const fields: unknown = Reflect.get(value, "fields");
	return [{ name, href, fields: Array.isArray(fields) ? fields.flatMap(toField) : undefined }];
}

function toEntity(value: unknown): SirenEntity | undefined {
	if (!isRecord(value)) return undefined;
	const classes: unknown = Reflect.get(value, "class");
	if (!Array.isArray(classes) || !classes.every((name) => typeof name === "string")) return undefined;
	const properties: unknown = Reflect.get(value, "properties");
	const actions: unknown = Reflect.get(value, "actions");
	return {
		class: classes,
		message: isRecord(properties) ? optionalString(Reflect.get(properties, "message")) : undefined,
		actions: Array.isArray(actions) ? actions.flatMap(toAction) : [],
	};
}

function readAnswer(request: UploadRequest, requestUrl: string): Answer {
	const isSiren = String(request.getResponseHeader("Content-Type")).includes(SIREN_MEDIA_TYPE);
	const entity = isSiren ? toEntity(parseJson(request.responseText)) : undefined;
	if (isSiren && !entity) return { kind: "failed" };
	if (entity?.class.includes("error")) {
		assert(entity.message, "a Siren error must carry its message");
		return { kind: "refused", message: entity.message };
	}
	if (request.responseURL !== requestUrl) return { kind: "navigate", url: request.responseURL };
	if (entity && request.status < 300) return { kind: "entity", entity };
	return { kind: "failed" };
}

function findAction(entity: SirenEntity, name: string): SirenAction | undefined {
	return entity.actions.find((action) => action.name === name);
}

interface Widget {
	form: HTMLFormElement;
	input: HTMLInputElement;
	zone: HTMLElement;
	error: HTMLElement;
	meta: HTMLElement;
	fill: HTMLElement;
	label: HTMLElement;
}

function widgetOf(view: Window & typeof globalThis, target: EventTarget | null): Widget | undefined {
	if (!(target instanceof view.Element)) return undefined;
	const form = target.closest("[data-upload-dropzone]");
	if (!(form instanceof view.HTMLFormElement)) return undefined;
	const input = form.querySelector<HTMLInputElement>('input[type="file"]');
	const zone = form.querySelector<HTMLElement>("[data-upload-dropzone-zone]");
	const error = form.querySelector<HTMLElement>("[data-upload-dropzone-error]");
	const meta = form.querySelector<HTMLElement>("[data-upload-dropzone-meta]");
	const fill = form.querySelector<HTMLElement>("[data-upload-dropzone-progress-fill]");
	const label = form.querySelector<HTMLElement>("[data-upload-dropzone-progress-label]");
	assert(input && zone && error && meta && fill && label, "the upload dropzone is missing one of its parts");
	return { form, input, zone, error, meta, fill, label };
}

function windowOf(doc: Document): Window & typeof globalThis {
	const view = doc.defaultView;
	assert(view, "the upload dropzone must live in a window");
	return view;
}

export function initUploadDropzone(deps: UploadDropzoneDeps): void {
	const doc = deps.document;
	const view = windowOf(doc);
	const resolve = (href: string): string => new URL(href, doc.baseURI).href;

	function message(widget: Widget, key: string): string {
		const text = widget.form.getAttribute(`data-message-${key}`);
		assert(text, `the upload dropzone must carry data-message-${key}`);
		return text;
	}

	function showError(widget: Widget, text: string): void {
		widget.form.dataset.uploadState = "idle";
		widget.error.textContent = text;
		widget.error.hidden = false;
		widget.input.setAttribute("aria-invalid", "true");
	}

	function clearError(widget: Widget): void {
		widget.error.textContent = "";
		widget.error.hidden = true;
		widget.input.removeAttribute("aria-invalid");
	}

	function showProgress(widget: Widget, progress: UploadProgress): void {
		if (!progress.lengthComputable || progress.total <= 0) return;
		const pct = Math.min(100, Math.max(0, Math.round((progress.loaded / progress.total) * 100)));
		widget.fill.style.width = `${pct}%`;
		widget.label.textContent = `Uploading ${formatBytes(progress.loaded)} of ${formatBytes(progress.total)} (${pct}%)`;
	}

	function send(input: {
		method: string;
		url: string;
		body: FormData | string;
		contentType?: string;
		onProgress?: (progress: UploadProgress) => void;
		onDone: (request: UploadRequest) => void;
		onError: () => void;
	}): void {
		const request = deps.createRequest();
		request.open(input.method, input.url);
		request.setRequestHeader("Accept", SIREN_ACCEPT);
		if (input.contentType) request.setRequestHeader("Content-Type", input.contentType);
		if (input.onProgress) request.upload.onprogress = input.onProgress;
		request.onload = () => input.onDone(request);
		request.onerror = input.onError;
		request.send(input.body);
	}

	function follow(widget: Widget, request: UploadRequest, url: string, next: (entity: SirenEntity) => void): void {
		const answer = readAnswer(request, url);
		if (answer.kind === "refused") showError(widget, answer.message);
		else if (answer.kind === "navigate") deps.navigate(answer.url);
		else if (answer.kind === "entity") next(answer.entity);
		else showError(widget, message(widget, "failed"));
	}

	function uploadLinks(widget: Widget, file: File): void {
		const url = widget.form.action;
		const body = new view.FormData();
		body.append("file", file, file.name);
		send({
			method: "POST",
			url,
			body,
			onProgress: (progress) => showProgress(widget, progress),
			onDone: (request) => follow(widget, request, url, () => showError(widget, message(widget, "failed"))),
			onError: () => showError(widget, message(widget, "failed")),
		});
	}

	function confirmReceived(widget: Widget, action: SirenAction): void {
		const url = resolve(action.href);
		send({
			method: "POST",
			url,
			body: "",
			contentType: "application/x-www-form-urlencoded",
			onDone: (request) => follow(widget, request, url, () => showError(widget, message(widget, "failed"))),
			onError: () => showError(widget, message(widget, "failed")),
		});
	}

	function uploadContent(widget: Widget, file: File, entity: SirenEntity): void {
		const upload = findAction(entity, "upload-content");
		const confirm = findAction(entity, "confirm-received");
		if (!upload || !confirm) {
			showError(widget, message(widget, "failed"));
			return;
		}
		const body = new view.FormData();
		assert(upload.fields, "the upload-content action must name the presigned fields");
		for (const field of upload.fields) {
			if (field.type !== "file") body.append(field.name, String(field.value));
		}
		body.append("file", file, file.name);
		send({
			method: "POST",
			url: upload.href,
			body,
			onProgress: (progress) => showProgress(widget, progress),
			onDone: (request) => {
				if (request.status === 201) confirmReceived(widget, confirm);
				else showError(widget, message(widget, "failed"));
			},
			onError: () => showError(widget, message(widget, "failed")),
		});
	}

	function uploadBook(widget: Widget, file: File, contentType: string): void {
		const startAction = widget.form.getAttribute("data-book-start-action");
		assert(startAction, "the upload dropzone must carry data-book-start-action");
		const url = resolve(startAction);
		const body = new URLSearchParams({ contentType, fileName: file.name, byteLength: String(file.size) }).toString();
		send({
			method: "POST",
			url,
			body,
			contentType: "application/x-www-form-urlencoded",
			onDone: (request) => follow(widget, request, url, (entity) => uploadContent(widget, file, entity)),
			onError: () => showError(widget, message(widget, "failed")),
		});
	}

	function bookContentType(file: File, bookAccept: string): string {
		const name = file.name.toLowerCase();
		const entries = parseBookAccept(bookAccept);
		const match = entries.find((entry) => entry.type === file.type) ??
			entries.find((entry) => entry.extensions.some((extension) => name.endsWith(extension)));
		assert(match, "a file classified as a book must match one of the book types");
		return match.type;
	}

	function chosenFile(widget: Widget): File | undefined {
		const files = widget.input.files;
		assert(files, "a file input always has a file list");
		return files[0];
	}

	function handle(widget: Widget, file: File | undefined): void {
		if (widget.input.disabled || !file) return;
		widget.meta.textContent = file.name;
		clearError(widget);
		const bookAccept = widget.form.getAttribute("data-book-accept");
		assert(bookAccept, "the upload dropzone must carry data-book-accept");
		const kind = classifyFile(file, bookAccept);
		if (kind === "unsupported") {
			showError(widget, message(widget, "unsupported"));
			return;
		}
		const limit = Number(widget.form.getAttribute(kind === "book" ? "data-book-max-bytes" : "data-import-max-bytes"));
		if (file.size > limit) {
			showError(widget, message(widget, kind === "book" ? "book-too-large" : "import-too-large"));
			return;
		}
		const signInHref = widget.form.getAttribute("data-sign-in-href");
		if (kind === "book" && signInHref) {
			deps.navigate(signInHref);
			return;
		}
		widget.form.dataset.uploadState = "uploading";
		if (kind === "book") uploadBook(widget, file, bookContentType(file, bookAccept));
		else uploadLinks(widget, file);
	}

	doc.addEventListener("change", (event) => {
		const widget = widgetOf(view, event.target);
		if (widget) handle(widget, chosenFile(widget));
	});

	for (const type of ["dragenter", "dragover"]) {
		doc.addEventListener(type, (event) => {
			const widget = widgetOf(view, event.target);
			if (!widget || widget.input.disabled) return;
			event.preventDefault();
			widget.zone.classList.add("upload-dropzone--dragover");
		});
	}

	for (const type of ["dragleave", "dragend"]) {
		doc.addEventListener(type, (event) => {
			widgetOf(view, event.target)?.zone.classList.remove("upload-dropzone--dragover");
		});
	}

	doc.addEventListener("submit", (event) => {
		const widget = widgetOf(view, event.target);
		if (!widget) return;
		event.preventDefault();
		handle(widget, chosenFile(widget));
	});

	doc.addEventListener("drop", (event) => {
		const widget = widgetOf(view, event.target);
		if (!widget) return;
		event.preventDefault();
		widget.zone.classList.remove("upload-dropzone--dragover");
		const files: FileList | undefined = Reflect.get(event, "dataTransfer")?.files;
		if (!files || files.length === 0) return;
		widget.input.files = files;
		handle(widget, files[0]);
	});
}
