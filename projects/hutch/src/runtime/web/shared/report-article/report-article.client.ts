export interface ReportArticleDeps {
	document: Document;
	sendBeacon: (url: string) => void;
}

const POPOVER_ID = "report-article";
const FORM_SELECTOR = "form[data-report-article-form]";
const SEND_FAILED_STATUS = 502;

function isElement(node: EventTarget | null): node is Element {
	return typeof Reflect.get(Object(node), "closest") === "function";
}

function detailOf(event: Event): object {
	return Object(Reflect.get(event, "detail"));
}

function statusOf(event: Event): unknown {
	return Reflect.get(Object(Reflect.get(detailOf(event), "xhr")), "status");
}

export function initReportArticle(deps: ReportArticleDeps): void {
	deps.document.addEventListener(
		"toggle",
		(event) => {
			const target = event.target;
			if (!isElement(target) || target.id !== POPOVER_ID || Reflect.get(event, "newState") !== "open") return;
			const url = target.getAttribute("data-beacon-url");
			if (url !== null) deps.sendBeacon(url);
		},
		true,
	);

	deps.document.addEventListener("htmx:beforeSwap", (event) => {
		const target = event.target;
		if (!isElement(target) || !target.matches(FORM_SELECTOR) || statusOf(event) !== SEND_FAILED_STATUS) return;
		Reflect.set(detailOf(event), "shouldSwap", true);
		Reflect.set(detailOf(event), "isError", false);
	});
}
