import WebKit

/// What the reader's WKWebView should do with a navigation. Pure and
/// `Equatable` so the decision can be unit-tested without a live web view.
enum ReaderNavigationDecision: Equatable {
	case allow
	case close
	case logout
	case openExternally(URL)
}

/// Decides what the iOS reader does with each navigation, kept UI-free so the
/// rules are unit-tested directly. The WKWebView delegate is the only untested
/// glue (an OS boundary), like `ReaderBridge` before it.
enum ReaderNavigation {
	/// A footnote tap is a scroll, not a navigation, so it must not open a
	/// browser. No host allowlist — readplace.com article links open in the
	/// browser too.
	///
	/// The `readplace://` deep links are matched ahead of the `.linkActivated`
	/// branch, and regardless of navigation type: the account page reaches the
	/// logout link through htmx's `HX-Redirect` (a `.other` navigation), not a tap.
	static func decide(
		url: URL,
		navigationType: WKNavigationType,
		currentURL: URL?
	) -> ReaderNavigationDecision {
		if let deepLink = deepLinkDecision(url) {
			return deepLink
		}

		if let currentURL, isSameDocumentFragment(url, of: currentURL) {
			return .allow
		}

		if navigationType == .linkActivated {
			return .openExternally(url)
		}

		return .allow
	}

	private static func deepLinkDecision(_ url: URL) -> ReaderNavigationDecision? {
		guard url.scheme?.lowercased() == AppConfig.callbackURLScheme else { return nil }
		switch (url.host?.lowercased(), url.path) {
		case ("reader", "/close"):
			return .close
		case ("account", "/logout"):
			return .logout
		default:
			return nil
		}
	}

	private static func isSameDocumentFragment(_ url: URL, of currentURL: URL) -> Bool {
		guard url.fragment != nil else { return false }
		return url.scheme == currentURL.scheme
			&& url.host == currentURL.host
			&& url.port == currentURL.port
			&& url.path == currentURL.path
			&& url.query == currentURL.query
	}
}
