import WebKit

/// What the reader's WKWebView should do with a navigation. Pure and
/// `Equatable` so the decision can be unit-tested without a live web view.
enum ReaderNavigationDecision: Equatable {
	/// Let the web view perform the navigation in place (initial load, redirect,
	/// back/forward swipe, same-document scroll, sub-frame load).
	case allow
	/// Cancel and close the reader sheet — the native list takes over.
	case close
	/// Cancel and hand the URL to an external browser.
	case openExternally(URL)
}

/// Decides what the iOS reader does with each navigation, kept UI-free so the
/// rules are unit-tested directly. The WKWebView delegate is the only untested
/// glue (an OS boundary), like `ReaderBridge` before it.
enum ReaderNavigation {
	/// Rules, top to bottom:
	///  a. the `readplace://reader/close` deep link closes the sheet (any nav type);
	///  b. a same-document fragment of the current page stays in the web view — a
	///     footnote tap is a scroll, not a navigation, so it must not open a browser;
	///  c. a tapped (`.linkActivated`) http(s) link opens externally, with no host
	///     allowlist — readplace.com article links open in the browser too;
	///  d. anything else (initial `.other` load, redirects, `.backForward` swipe,
	///     sub-frame loads, non-http(s) non-close schemes) is allowed in place.
	static func decide(
		url: URL,
		navigationType: WKNavigationType,
		currentURL: URL?,
	) -> ReaderNavigationDecision {
		if url.scheme == "readplace", url.host == "reader", url.path == "/close" {
			return .close
		}

		if let currentURL, isSameDocumentFragment(url, of: currentURL) {
			return .allow
		}

		if navigationType == .linkActivated,
		   let scheme = url.scheme?.lowercased(),
		   scheme == "http" || scheme == "https" {
			return .openExternally(url)
		}

		return .allow
	}

	/// Whether `url` is the current page with only a `#fragment` added — same
	/// scheme, host, port, path and query, differing solely by the fragment.
	private static func isSameDocumentFragment(_ url: URL, of currentURL: URL) -> Bool {
		guard url.fragment != nil else { return false }
		return url.scheme == currentURL.scheme
			&& url.host == currentURL.host
			&& url.port == currentURL.port
			&& url.path == currentURL.path
			&& url.query == currentURL.query
	}
}
