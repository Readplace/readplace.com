import { DocumentLandingPageError, documentLandingPageFailure, rejectDocumentLandingPage } from "./document-landing-page";
import { withResolvedUrl } from "./follow-redirects";
import { TransportLadderFailure } from "./transport-ladder-failure";

const url = "https://publisher.example/archive/docs/report.pdf";
const home = "https://publisher.example/archive/";
function response(body: ConstructorParameters<typeof Response>[0] = "<html>homepage</html>", terminal = home, type: string | null = "text/html", status = 200) {
	const answer = new Response(body, { status, headers: type === null ? {} : { "content-type": type } });
	if (type === null) answer.headers.delete("content-type");
	return withResolvedUrl(answer, terminal);
}

it.each([
	["invalid", home, "text/html", 200],
	[url, "invalid", "text/html", 200],
	["ftp://publisher.example/archive/report.pdf", "ftp://publisher.example/", "text/html", 200],
	["https://publisher.example/archive/article", home, "text/html", 200],
	["https://elsewhere.example/archive/report.pdf", home, "text/html", 200],
	[url, "", "text/html", 200],
	[url, "https://elsewhere.example/", "text/html", 200],
	[url, url, "text/html", 200],
	[url, "https://publisher.example/archive/docs/report.html", "text/html", 200],
	[url, "https://publisher.example/arch", "text/html", 200],
	[url, "https://publisher.example/archive/?document=report.pdf", "text/html", 200],
	[url, "https://publisher.example/archive/#document=report.pdf", "text/html", 200],
	[url, home, "application/pdf", 200],
	[url, home, null, 200],
	[url, home, "text/html", 404],
] satisfies Array<[string, string, string | null, number]>)("preserves a response without evidence of document identity loss: %s -> %s (%s %s)", async (requested, terminal, type, status) => {
	const answer = response("unchanged", terminal, type, status);
	await rejectDocumentLandingPage(requested, answer);
	expect(await answer.text()).toBe("unchanged");
});

it.each([
	[url, home, "text/html"],
	[url, "https://publisher.example/archive", "text/html"],
	[url, "https://publisher.example/", "text/html; charset=utf-8"],
	["https://journal.example.org/papers/annual.PDF", "https://journal.example.org/papers/", "application/xhtml+xml"],
	["http://archive.example:8080/reports/file.pdf?download=1", "http://archive.example:8080/", "TEXT/HTML"],
])("recovers a document redirected to an HTML directory: %s -> %s", async (requested, terminal, type) => {
	const answer = response("homepage", terminal, type);
	await expect(rejectDocumentLandingPage(requested, answer)).rejects.toBeInstanceOf(DocumentLandingPageError);
	expect(answer.bodyUsed).toBe(true);
});

it.each([null, "", "abc"])("rejects missing or short body %s", async (body) => {
	await expect(rejectDocumentLandingPage(url, response(body))).rejects.toBeInstanceOf(DocumentLandingPageError);
});

it("accepts PDF magic across chunks despite wrong MIME and preserves the body", async () => {
	const answer = response(new ReadableStream({ start(controller) {
		controller.enqueue(new TextEncoder().encode("%P"));
		controller.enqueue(new TextEncoder().encode("DF-1.7"));
		controller.close();
	} }));
	await rejectDocumentLandingPage(url, answer);
	expect(await answer.text()).toBe("%PDF-1.7");
});

it("propagates a probe read failure", async () => {
	const error = new Error("body disconnected");
	const answer = response(new ReadableStream({ start(controller) { controller.error(error); } }));
	await expect(rejectDocumentLandingPage(url, answer)).rejects.toThrow("body disconnected");
});

it("checks buffered responses without cancelling the consumed stream", async () => {
	await expect(rejectDocumentLandingPage(url, response(), Buffer.from("homepage"))).rejects.toBeInstanceOf(DocumentLandingPageError);
	await rejectDocumentLandingPage(url, response(), Buffer.from("%PDF-1.7"));
});

it("finds the mismatch among previous transport failures", () => {
	const mismatch = new DocumentLandingPageError({ requestedUrl: url, landingPageUrl: home });
	const wrapped = new TransportLadderFailure({ escalatedStatuses: [], previousErrors: [new Error("timeout"), mismatch], error: new Error("later timeout"), retryDisposition: "recoverable" });
	expect(documentLandingPageFailure(wrapped)).toBe(mismatch);
	expect(documentLandingPageFailure(new TransportLadderFailure({ escalatedStatuses: [], previousErrors: [], error: undefined, retryDisposition: "unclassified" }))).toBeUndefined();
});

it.each([true, false])("uses the latest rejected landing page when the final attempt times out: %s", (timedOut) => {
	const earlier = new DocumentLandingPageError({ requestedUrl: url, landingPageUrl: home });
	const latest = new DocumentLandingPageError({ requestedUrl: url, landingPageUrl: "https://publisher.example/archive/docs/" });
	const wrapped = new TransportLadderFailure({ escalatedStatuses: [],
		previousErrors: timedOut ? [earlier, latest] : [earlier],
		error: timedOut ? new Error("timeout") : latest,
		retryDisposition: "recoverable",
	});
	expect(documentLandingPageFailure(wrapped)).toBe(latest);
});
