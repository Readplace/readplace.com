import UIKit

/// The browser seam the app opens external URLs through, kept in the App target so
/// the tested cores stay free of UIKit. `.system` uses the live `UIApplication`;
/// tests inject their own closure. `open` mirrors
/// `UIApplication.open(_:options:completionHandler:)` — its `Bool` reports whether
/// the system accepted the URL, which the Chrome-first flow needs to decide
/// whether to fall back; the reader's plain "open externally" ignores it.
struct ExternalBrowser {
	let open: (_ url: URL, _ completion: @escaping (Bool) -> Void) -> Void

	static let system = ExternalBrowser(
		open: { url, completion in UIApplication.shared.open(url, options: [:], completionHandler: completion) }
	)
}

/// Opens the OAuth authorize URL Chrome-first: it rewrites the https URL to
/// `googlechromes://` and opens Chrome, so login lands in the browser where the
/// user already has a Readplace web session. Only when the system reports Chrome
/// could not be opened (Chrome not installed) does it fall back to the original
/// https URL in the default browser — never as the default path, because most
/// users keep Safari as the iOS default yet are signed in only in Chrome.
func openAuthorizeURLChromeFirst(_ httpsURL: URL, browser: ExternalBrowser) {
	browser.open(chromeURLForHTTPS(httpsURL)) { openedInChrome in
		guard !openedInChrome else { return }
		browser.open(httpsURL) { _ in }
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
		openAuthorizeURL: { httpsURL in openAuthorizeURLChromeFirst(httpsURL, browser: browser) },
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
