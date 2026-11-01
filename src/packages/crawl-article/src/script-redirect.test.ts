import { MAX_HTML_BYTES } from "./html-body-limit";
import { scriptRedirectTarget } from "./script-redirect";

const TRACKER_URL = "https://email.tracker.example/MzAwLUFCQy0xMjM/abcDEF123";
const DESTINATION_URL = "https://news.example/2026/10/a-report?mkt_tok=TOKEN";

function stubHtml(params: { redirectUrl: string; body?: string; extraHead?: string }): string {
	return `<html>
<head>
<meta charset='UTF-8'>
<meta name='robots' content='noindex'>
<script language='javascript'>
var redirecturl = '${params.redirectUrl}';
document.getElementsByTagName('head')[0].addEventListener('load',redirect());
function redirect() {
var anchor = window.location.hash;
window.self.location = redirecturl + anchor;
}
</script>${params.extraHead ?? ""}
</head>
<body>${params.body ?? ""}</body>
</html>
`;
}

function page(params: { html: string; status?: number; headers?: Record<string, string> }) {
	return {
		response: new Response(null, {
			status: params.status ?? 302,
			headers: params.headers ?? { "content-type": "text/html; charset=UTF-8" },
		}),
		buffer: Buffer.from(params.html),
		documentUrl: TRACKER_URL,
	};
}

describe("scriptRedirectTarget", () => {
	it("returns the destination of a click-tracker stub answered as a 302 with no Location", () => {
		expect(scriptRedirectTarget(page({ html: stubHtml({ redirectUrl: DESTINATION_URL }) }))).toBe(DESTINATION_URL);
	});

	it.each([301, 303, 307, 308])("returns the destination of the stub answered as a %i with no Location", (status) => {
		expect(scriptRedirectTarget(page({ html: stubHtml({ redirectUrl: DESTINATION_URL }), status }))).toBe(DESTINATION_URL);
	});

	it("reads a double-quoted assignment and resolves a relative destination against the tracker URL", () => {
		const html = '<html><head><script>var redirecturl = "/landing?id=1";</script></head><body></body></html>';

		expect(scriptRedirectTarget(page({ html }))).toBe("https://email.tracker.example/landing?id=1");
	});

	it("returns undefined for a stub whose body has visible text", () => {
		const html = stubHtml({ redirectUrl: DESTINATION_URL, body: "<p>An article that happens to define redirecturl.</p>" });

		expect(scriptRedirectTarget(page({ html }))).toBeUndefined();
	});

	it.each(["javascript:alert(1)", "data:text/html,hi"])("returns undefined for a stub redirecting to %s", (redirectUrl) => {
		expect(scriptRedirectTarget(page({ html: stubHtml({ redirectUrl }) }))).toBeUndefined();
	});

	it("returns undefined for a destination that does not parse", () => {
		expect(scriptRedirectTarget(page({ html: stubHtml({ redirectUrl: "http://[" }) }))).toBeUndefined();
	});

	it("returns undefined for a 302 that carries a Location header", () => {
		const headers = { "content-type": "text/html", location: DESTINATION_URL };

		expect(scriptRedirectTarget(page({ html: stubHtml({ redirectUrl: DESTINATION_URL }), headers }))).toBeUndefined();
	});

	it("returns undefined for the stub answered with a 200", () => {
		expect(scriptRedirectTarget(page({ html: stubHtml({ redirectUrl: DESTINATION_URL }), status: 200 }))).toBeUndefined();
	});

	it("returns undefined for the stub served as text/plain", () => {
		const headers = { "content-type": "text/plain" };

		expect(scriptRedirectTarget(page({ html: stubHtml({ redirectUrl: DESTINATION_URL }), headers }))).toBeUndefined();
	});

	it("returns undefined for the stub served without a content type", () => {
		expect(scriptRedirectTarget(page({ html: stubHtml({ redirectUrl: DESTINATION_URL }), headers: {} }))).toBeUndefined();
	});

	it("returns undefined for a body over the HTML parse cap", () => {
		const html = stubHtml({ redirectUrl: DESTINATION_URL }) + " ".repeat(MAX_HTML_BYTES.bytes);

		expect(scriptRedirectTarget(page({ html }))).toBeUndefined();
	});

	it("returns undefined for a stub with a second script", () => {
		const html = stubHtml({ redirectUrl: DESTINATION_URL, extraHead: "<script>analytics.track();</script>" });

		expect(scriptRedirectTarget(page({ html }))).toBeUndefined();
	});

	it("returns undefined for a redirect page whose script assigns no redirecturl", () => {
		const html = "<html><head><script>window.location = '/elsewhere';</script></head><body></body></html>";

		expect(scriptRedirectTarget(page({ html }))).toBeUndefined();
	});
});
