import { MAX_HTML_BYTES } from "./html-body-limit";
import { metaRefreshTarget } from "./meta-refresh";

function page(params: { html: string; status?: number; contentType?: string | null; documentUrl?: string }) {
	return {
		response: new Response(null, {
			status: params.status ?? 200,
			headers: params.contentType === null ? {} : { "content-type": params.contentType ?? "text/html" },
		}),
		buffer: Buffer.from(params.html),
		documentUrl: params.documentUrl ?? "https://blog.example/posts/a-post.",
	};
}

const ALIAS_HTML =
	'<!doctype html><html lang=en-gb><head><title>https://blog.example/posts/a-post/</title><link rel=canonical href=https://blog.example/posts/a-post/><meta charset=utf-8><meta http-equiv=refresh content="0; url=https://blog.example/posts/a-post/"></head></html>';

describe("metaRefreshTarget", () => {
	it("returns the target of an alias page that refreshes at once and has no body", () => {
		expect(metaRefreshTarget(page({ html: ALIAS_HTML }))).toBe("https://blog.example/posts/a-post/");
	});

	it("returns the target when a robots meta precedes the refresh and a beacon script follows </html>", () => {
		const html =
			'<!doctype html><html lang=en-GB><head><title>https://essays.example/2020/a-essay/</title><link rel=canonical href=https://essays.example/2020/a-essay/><meta name=robots content="noindex"><meta charset=utf-8><meta http-equiv=refresh content="0; url=https://essays.example/2020/a-essay/"></head></html><script type="module" src="https://beacon.example/b.js" crossorigin="anonymous"></script>';

		expect(metaRefreshTarget(page({ html, documentUrl: "https://essays.example/a-essay/" }))).toBe(
			"https://essays.example/2020/a-essay/",
		);
	});

	it("reads an uppercase HTTP-EQUIV, a delay, a single-quoted relative URL and an &amp; entity on a page whose body holds only hidden inputs", () => {
		const html = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
<html>
<head>
<meta charset="utf-8">
<META http-equiv=Content-Type content="text/html">
<meta HTTP-EQUIV="REFRESH" content="2; url='/retrieve/select?next=https%3A%2F%2Fpublisher.example%2Farticle&amp;key=k1'"/>
<title>Redirecting</title>
<script type="text/javascript">function go() { window.location = "/retrieve/elsewhere"; }</script>
</head>
<body onload="go();">
<tr style="display:none;"><td colspan="2"><input type="hidden" name="key" value="k1"/></td></tr>
</body>
<script>analytics.track("redirect");</script>
</html>`;

		expect(
			metaRefreshTarget(
				page({ html, contentType: "text/html;charset=UTF-8", documentUrl: "https://hub.example/retrieve/item/0001" }),
			),
		).toBe("https://hub.example/retrieve/select?next=https%3A%2F%2Fpublisher.example%2Farticle&key=k1");
	});

	it.each([
		`<html><head><meta http-equiv="refresh" content="0; url='/next'"></head></html>`,
		`<html><head><meta http-equiv="refresh" content="0; url=&quot;/next&quot;"></head></html>`,
	])("strips the quotes around the URL in %s", (html) => {
		expect(metaRefreshTarget(page({ html }))).toBe("https://blog.example/next");
	});

	it("returns undefined for a readable page that reloads itself on a timer", () => {
		const html =
			'<html><head><meta http-equiv="refresh" content="300; url=https://blog.example/posts/a-post."></head><body><p>Breaking news.</p></body></html>';

		expect(metaRefreshTarget(page({ html }))).toBeUndefined();
	});

	it("returns undefined for a refresh that names no URL", () => {
		expect(metaRefreshTarget(page({ html: '<html><head><meta http-equiv="refresh" content="300"></head></html>' }))).toBeUndefined();
	});

	it("returns undefined for a page whose text the parser leaves outside a body it never opened", () => {
		const html = '<!doctype html><title>Live</title><meta http-equiv=refresh content="0; url=/next"><p>Article paragraph.</p>';

		expect(metaRefreshTarget(page({ html }))).toBeUndefined();
	});

	it.each(["javascript:alert(1)", "data:text/html,hi"])("returns undefined for a refresh to %s", (target) => {
		const html = `<html><head><meta http-equiv=refresh content="0; url=${target}"></head></html>`;

		expect(metaRefreshTarget(page({ html }))).toBeUndefined();
	});

	it("returns undefined for a refresh whose URL does not parse", () => {
		const html = '<html><head><meta http-equiv=refresh content="0; url=http://["></head></html>';

		expect(metaRefreshTarget(page({ html }))).toBeUndefined();
	});

	it("returns undefined for an alias page served with a 404", () => {
		expect(metaRefreshTarget(page({ html: ALIAS_HTML, status: 404 }))).toBeUndefined();
	});

	it("returns undefined for an alias page served as text/plain", () => {
		expect(metaRefreshTarget(page({ html: ALIAS_HTML, contentType: "text/plain" }))).toBeUndefined();
	});

	it("returns undefined for an alias page served without a content type", () => {
		expect(metaRefreshTarget(page({ html: ALIAS_HTML, contentType: null }))).toBeUndefined();
	});

	it("returns undefined for a body over the HTML parse cap", () => {
		expect(metaRefreshTarget(page({ html: ALIAS_HTML + " ".repeat(MAX_HTML_BYTES.bytes) }))).toBeUndefined();
	});

	it("returns undefined for an article without a refresh", () => {
		const html = "<html><head><meta charset=utf-8><title>A post</title></head><body><p>Text.</p></body></html>";

		expect(metaRefreshTarget(page({ html }))).toBeUndefined();
	});
});
