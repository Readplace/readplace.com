import Foundation

/// Rewrites an `https` authorize URL to Chrome's `googlechromes` scheme so the
/// OS opens it in Chrome (reusing the user's Chrome session) when Chrome is
/// installed; otherwise returns the URL unchanged so the default browser opens
/// it. Host, path and query are preserved either way.
///
/// `canOpen` is injected (it wraps `UIApplication.canOpenURL` in the app, a stub
/// in tests). Chrome documents `googlechrome://` for http and `googlechromes://`
/// for https; the authorize URL is always https, so we use `googlechromes`.
func chromeURLForHTTPS(_ httpsURL: URL, canOpen: (URL) -> Bool) -> URL {
	guard canOpen(URL(string: "googlechromes://")!) else { return httpsURL }
	var components = URLComponents(url: httpsURL, resolvingAgainstBaseURL: false)
	components?.scheme = "googlechromes"
	return components?.url ?? httpsURL
}

/// The seams the UI-free Sign up core needs, injected so tests never launch a
/// browser or hit the network: how to build the authorize request, where to
/// persist the in-flight secrets, how to detect/open the browser, and how to
/// exchange the returned code.
struct WebSignupDependencies {
	let makeAuthorizationRequest: () -> AuthorizationRequest
	let pendingStore: SignupPendingStore
	let canOpenURL: (URL) -> Bool
	let openURL: (URL) -> Void
	let exchange: (_ callbackURL: URL, _ pending: PendingSignup) async -> Result<Void, Error>
}

/// The UI-free core of the external-browser Sign up flow. `start` is invoked
/// from the Sign up button; `complete` from the `readplace://oauth-callback`
/// deep link (possibly in a fresh process after a cold relaunch).
struct SignupFlow {
	let start: () -> Void
	/// Returns `nil` when there is no pending record (an unexpected deep link),
	/// otherwise the result of exchanging the returned code.
	let complete: (URL) async -> Result<Void, Error>?
}

/// Partial application (`init*`) wiring the injected seams into a `SignupFlow`.
func initWebSignup(deps: WebSignupDependencies) -> SignupFlow {
	SignupFlow(
		start: {
			let request = deps.makeAuthorizationRequest()
			// Persist BEFORE opening the browser: the app may be killed during the
			// external-browser hop, so the deep-link callback must be able to read
			// these back from a cold launch.
			deps.pendingStore.save(PendingSignup(
				verifier: request.codeVerifier,
				state: request.state,
				redirectURI: request.redirectURI
			))
			deps.openURL(chromeURLForHTTPS(request.url, canOpen: deps.canOpenURL))
		},
		complete: { callbackURL in
			guard let pending = deps.pendingStore.load() else { return nil }
			deps.pendingStore.clear()
			return await deps.exchange(callbackURL, pending)
		}
	)
}
