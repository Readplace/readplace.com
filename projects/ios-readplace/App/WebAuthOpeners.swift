import UIKit

/// The browser seam the app opens external URLs through, kept in the App target so
/// the tested cores stay free of UIKit. `.system` uses the live `UIApplication`;
/// tests inject their own closure. `open` mirrors
/// `UIApplication.open(_:options:completionHandler:)` — its `Bool` reports whether
/// the system accepted the URL, which the Chrome-first flow needs to decide
/// whether to fall back.
struct ExternalBrowser {
	let open: (_ url: URL, _ completion: @escaping (Bool) -> Void) -> Void

	static let system = ExternalBrowser(
		open: { url, completion in UIApplication.shared.open(url, options: [:], completionHandler: completion) }
	)
}

/// Opens a URL Chrome-first *when it is one of ours*: `chromeURLFor` rewrites a
/// readplace.com URL to Chrome's scheme so it lands in the browser where the user
/// already has a Readplace web session. Only when the system reports Chrome could
/// not be opened (Chrome not installed) does it fall back to the original URL in
/// the default browser — never as the default path, because most users keep Safari
/// as the iOS default yet are signed in only in Chrome.
///
/// Every external open goes through here, so the rule lives in one place: the OAuth
/// authorize URL and the changelog banner's "Read more" are ours and get Chrome;
/// a link to someone else's site is handed to the system untouched, which keeps
/// Universal Links resolving to native apps and respects the user's default
/// browser. `chromeURLFor` owns that distinction — see it for why.
func openURLChromeFirst(_ url: URL, browser: ExternalBrowser) {
	guard let chromeURL = chromeURLFor(url) else {
		browser.open(url) { _ in }
		return
	}
	browser.open(chromeURL) { openedInChrome in
		guard !openedInChrome else { return }
		browser.open(url) { _ in }
	}
}

/// Composition root for the external-browser auth flow shared by Login and Sign
/// up: resolves the shared App Group store and wires the live browser + session
/// into a `WebAuthFlow`. `start` and the deep-link `complete` share state only
/// through the persisted store, so a cold relaunch on the callback still finds the
/// pending record.
@MainActor
func makeWebAuthFlow(session: AppSession) -> WebAuthFlow {
	let group = TokenStore.resolvedAppGroupId
	guard let defaults = UserDefaults(suiteName: group) else {
		preconditionFailure("App Group \(group) is required for the web auth flow")
	}
	let store = PendingAuthStore(defaults: defaults)
	let browser = ExternalBrowser.system
	return initWebAuthFlow(deps: WebAuthFlowDependencies(
		pendingStore: store,
		openAuthorizeURL: { httpsURL in openURLChromeFirst(httpsURL, browser: browser) },
		exchange: { callbackURL, pending in
			await session.completeSignIn(
				callbackURL: callbackURL,
				verifier: pending.verifier,
				expectedState: pending.state,
				redirectURI: pending.redirectURI
			)
		}
	))
}
