import UIKit

/// The browser seam the UI-free `WebAuthFlow` core opens through, kept in the App
/// target so the tested core stays free of UIKit. `.system` is backed by the
/// live `UIApplication`; tests inject their own closures.
///
/// `canOpen` needs the queried schemes (`googlechrome`/`googlechromes`) declared
/// in `Info.plist`'s `LSApplicationQueriesSchemes`, or it silently returns false
/// and the flow always falls back to the default browser.
struct ExternalBrowser {
	let canOpen: (URL) -> Bool
	let open: (URL) -> Void

	static let system = ExternalBrowser(
		canOpen: { UIApplication.shared.canOpenURL($0) },
		open: { UIApplication.shared.open($0) }
	)
}

/// Composition root for the external-browser auth flow shared by Login and Sign
/// up: resolves the shared App Group store and wires the live browser + session
/// into a `WebAuthFlow`. Both buttons (`start`) and the deep-link callback
/// (`complete`) build the flow this way; they share state only through the
/// persisted store, so a cold relaunch on the callback still finds the pending
/// record. The login-vs-signup difference is the authorize request the caller
/// hands to `start`, so this root stays oblivious to which one it is.
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
		canOpenURL: browser.canOpen,
		openURL: browser.open,
		exchange: { callbackURL, pending in
			await session.completeSignIn(
				callbackURL: callbackURL,
				verifier: pending.verifier,
				expectedState: pending.state,
				redirectURI: pending.redirectURI,
				onExchangeStarted: {}
			)
		}
	))
}
