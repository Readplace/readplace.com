const SIREN_MEDIA_TYPE = "application/vnd.siren+json";
const SIREN_ACCEPT = `${SIREN_MEDIA_TYPE}, text/html;q=0.9`;

export type FileKind = "upload" | "links" | "unsupported";

export function acceptsFile(file: { name: string; type: string }, accept: string): boolean {
	const name = file.name.toLowerCase();
	return accept
		.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.some((entry) => (entry.startsWith(".") ? name.endsWith(entry) : entry === file.type));
}

function isTextShaped(type: string): boolean {
	return type.startsWith("text/") || type === "application/json" || type.endsWith("+xml") || type.endsWith("+json");
}

export function classifyFile(file: { name: string; type: string }, accepts: readonly string[]): FileKind {
	if (accepts.some((accept) => acceptsFile(file, accept))) return "upload";
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

interface OfferedKind {
	readonly accept: string;
	readonly maxBytes: number;
	readonly tooLarge: string;
}

function requiredAttribute(element: Element, name: string): string {
	const value = element.getAttribute(name);
	assert(value, `the upload dropzone must carry ${name}`);
	return value;
}

function offeredKindOf(element: Element): OfferedKind {
	return {
		accept: requiredAttribute(element, "data-accept"),
		maxBytes: Number(requiredAttribute(element, "data-max-bytes")),
		tooLarge: requiredAttribute(element, "data-message-too-large"),
	};
}

interface Widget {
	form: HTMLFormElement;
	input: HTMLInputElement;
	zone: HTMLElement;
	primary: HTMLElement;
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
	const primary = form.querySelector<HTMLElement>("[data-upload-dropzone-primary]");
	const error = form.querySelector<HTMLElement>("[data-upload-dropzone-error]");
	const meta = form.querySelector<HTMLElement>("[data-upload-dropzone-meta]");
	const fill = form.querySelector<HTMLElement>("[data-upload-dropzone-progress-fill]");
	const label = form.querySelector<HTMLElement>("[data-upload-dropzone-progress-label]");
	assert(input && zone && primary && error && meta && fill && label, "the upload dropzone is missing one of its parts");
	return { form, input, zone, primary, error, meta, fill, label };
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
		return requiredAttribute(widget.form, `data-message-${key}`);
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

	function uploadMedia(widget: Widget, file: File): void {
		const url = resolve(requiredAttribute(widget.form, "data-upload-start-action"));
		const body = new URLSearchParams({ fileName: file.name, byteLength: String(file.size) }).toString();
		send({
			method: "POST",
			url,
			body,
			contentType: "application/x-www-form-urlencoded",
			onDone: (request) => follow(widget, request, url, (entity) => uploadContent(widget, file, entity)),
			onError: () => showError(widget, message(widget, "failed")),
		});
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
		const offered = Array.from(widget.form.querySelectorAll("[data-upload-kind]"), offeredKindOf);
		const route = classifyFile(file, offered.map((kind) => kind.accept));
		if (route === "unsupported") {
			showError(widget, message(widget, "unsupported"));
			return;
		}
		if (route === "links") {
			if (file.size > Number(widget.form.getAttribute("data-import-max-bytes"))) {
				showError(widget, message(widget, "import-too-large"));
				return;
			}
			widget.form.dataset.uploadState = "uploading";
			uploadLinks(widget, file);
			return;
		}
		const kind = offered.find((candidate) => acceptsFile(file, candidate.accept));
		assert(kind, "a file routed to upload must match one of the offered kinds");
		if (file.size > kind.maxBytes) {
			showError(widget, kind.tooLarge);
			return;
		}
		const signInHref = widget.form.getAttribute("data-sign-in-href");
		if (signInHref) {
			deps.navigate(signInHref);
			return;
		}
		widget.form.dataset.uploadState = "uploading";
		uploadMedia(widget, file);
	}

	function keep(widget: Widget, file: File | undefined): void {
		if (widget.input.disabled || !file) return;
		widget.primary.textContent = file.name;
		clearError(widget);
	}

	function choose(widget: Widget, file: File | undefined): void {
		if (widget.form.dataset.uploadOnChoose === "true") handle(widget, file);
		else keep(widget, file);
	}

	doc.addEventListener("change", (event) => {
		const widget = widgetOf(view, event.target);
		if (widget) choose(widget, chosenFile(widget));
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
		choose(widget, files[0]);
	});
}
