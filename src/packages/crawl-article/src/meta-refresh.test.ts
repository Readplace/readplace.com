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


describe("the closed public publisher notice", () => {
	const source = "https://link.camper.com/u/nrd.php?d=synthetic-notice";
	const faq = "https://www.camper.com/int/at_cliente_faq?faq=97";
	const pdf = "https://www.camper.com/html/legal/pdfs/privacy/general_privacy_policy_EN.pdf";
	function notice(target: string, extra = "") {
		const escaped = target.replaceAll("&", "&amp;");
		return `<html><head><style type="text/css">body { color: #555; font-family: Arial, Verdana, Helvetica, sans-serif; font-weight: normal; font-size: 11px; } a { color: #555; }</style><meta http-equiv="content-type" content="text/html"><meta http-equiv="refresh" content="0; url=${escaped}"></head><body>If you are not redirected, please click <a href="${escaped}" id="redir">here</a>${extra}</body></html>`;
	}
	it("recognizes only the exact FAQ fallback notice and strips reviewed tracking", () => {
		const target = faq;
		const tracked = `${target + (target.includes("?") ? "&" : "?")}utm_source=synthetic&nw_section=footer&sc_uid=synthetic&usrhash=synthetic`;
		expect(metaRefreshTarget(page({ html: notice(tracked), documentUrl: source }))).toBe(target);
	});
	it.each(["22", "46", "51"])("preserves the accepted public answer selector %s", (selector) => {
		const target = faq.replace("faq=97", `faq=${selector}`);
		expect(metaRefreshTarget(page({ html: notice(`${target}&utm_source=synthetic`), documentUrl: source }))).toBe(target);
	});
	it.each(["faq=54", "faq=54&utm_source=synthetic", "faq=%35%34"])("keeps the nonempty returns notice instead of following %s", (query) => {
		const target = `https://www.camper.com/int/at_cliente_faq?${query}`;
		expect(metaRefreshTarget(page({ html: notice(target), documentUrl: source }))).toBeUndefined();
	});
	it.each([faq.replace("faq=97", "faq=54"), pdf])("preserves the prior textless refresh behavior for %s", (target) => {
		const html = `<html><head><meta http-equiv="refresh" content="0; url=${target}"></head></html>`;
		expect(metaRefreshTarget(page({ html, documentUrl: source }))).toBe(target);
	});
	it("also accepts the minimal notice without optional passive styling or the anchor id", () => {
		const html = notice(faq).replace(/<style[^>]*>.*?<\/style>/, "").replace(' id="redir"', "");
		expect(metaRefreshTarget(page({ html, documentUrl: source }))).toBe(faq);
	});
	it("normalizes the fallback sentence whitespace", () => {
		expect(metaRefreshTarget(page({ html: notice(faq).replace("not redirected", "not\n  redirected"), documentUrl: source }))).toBe(faq);
	});
	it.each([
		faq.replace("https:", "http:"), faq.replace("www.camper.com", "account.camper.com"), faq.replace("www.camper.com", "www.camper.com:444"), faq.replace("www.camper.com", "user:secret@www.camper.com"),
		`${faq}#`, `${faq}#action`, `${faq}&signature=synthetic`, `${faq}&token=synthetic`, `${faq}&action=delete`, `${faq}&utm_unreviewed=x`, `${faq}&sc_unknown=x`, `${faq}&next=https://example.test`, `${faq}&faq=98`, `${faq}&utm_source=a&utm_source=b`,
		faq.replace("97", "0"), faq.replace("97", "09"), faq.replace("97", "9"), faq.replace("97", "100"), faq.replace("97", "97delete"), faq.replace("97", "-97"), faq.replace("97", "97.0"), faq.replace("?faq=97", ""),
		faq.replace("/int/", "/en_GB/"), faq.replace("/int/", "/%69nt/"), faq.replace("/int/", "/other/../int/"), faq.replace("at_cliente_faq", "account_faq"), pdf, `${pdf}?utm_source=synthetic`, `${pdf}?faq=97`, `${pdf}?download=1`, pdf.replace("policy_EN", "policy_GB"),
	])("rejects unreviewed destination %s", (target) => {
		expect(metaRefreshTarget(page({ html: notice(target), documentUrl: source }))).toBeUndefined();
	});
	it.each([
		source.replace("https:", "http:"), source.replace("link.camper.com", "other.camper.com"), source.replace("/u/nrd.php", "/u/other.php"), source.replace("link.camper.com", "link.camper.com:444"), source.replace("link.camper.com", "user@link.camper.com"), `${source}#`, `${source}#fragment`,
	])("rejects an unreviewed notice source %s", (documentUrl) => {
		expect(metaRefreshTarget(page({ html: notice(faq), documentUrl }))).toBeUndefined();
	});
	it.each([201, 302, 404])("rejects the non-200 notice status %s", (status) => {
		expect(metaRefreshTarget(page({ html: notice(faq), documentUrl: source, status }))).toBeUndefined();
	});
	it.each([
		notice(faq, " Extra policy text."), notice(faq).replace("font-size: 11px", "font-size: 12px"), notice(faq).replace('type="text/css"', 'type="text/plain"'), notice(faq).replace('type="text/css"', ""), notice(faq).replace('type="text/css"', 'type="text/css" lang="en"'), notice(faq).replace('id="redir"', 'id="other"'), notice(faq).replace('<body>', '<body id="redir">'), notice(faq).replace('</head>', '<style type="text/css">body { color: red; }</style></head>'), notice(faq, '<form><button>Continue</button></form>'), notice(faq, '<img src="https://images.example.test/a.png">'), notice(faq, "<script>go()</script>"), notice(faq, '<a href="https://example.test">More</a>'),
		notice(faq).replace('content="0;', 'content="5;'), notice(faq).replace('</head>', `<meta http-equiv="refresh" content="0; url=${faq}"></head>`), notice(faq).replace(`href="${faq}"`, 'href="https://example.test/other"'), notice(faq).replace("please click", "please proceed"), notice(faq).replace(`<a href="${faq}" id="redir">here</a>`, "here"), notice(faq).replace(`href="${faq}"`, ""), notice(faq).replace(`<a href="${faq}" id="redir">`, `<a lang="en" href="${faq}" id="redir">`), notice(faq).replace('<body>', '<body onload="go()">'),
	])("rejects additional or mismatching notice content", (html) => {
		expect(metaRefreshTarget(page({ html, documentUrl: source }))).toBeUndefined();
	});
});
