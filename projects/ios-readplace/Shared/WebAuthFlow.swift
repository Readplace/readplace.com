import Foundation

/// Rewrites an `https` authorize URL to Chrome's `googlechromes` scheme so the OS
/// opens it in Chrome, which shares one cookie jar across scheme-opened tabs and
/// so reuses the user's existing Chrome web session. Host, path and query are
/// preserved. Chrome documents `googlechrome://` for http and `googlechromes://`
/// for https; the authorize URL is always https, so we use `googlechromes`.
///
/// The rewrite is unconditional: whether Chrome can actually be opened is left to
/// the system when the App seam opens the URL (via the open completion handler),
/// not to a `canOpenURL` pre-check — a false-negative probe must never silently
/// route login into the default browser (Safari), where the user isn't signed in.
func chromeURLForHTTPS(_ httpsURL: URL) -> URL {
	var components = URLComponents(url: httpsURL, resolvingAgainstBaseURL: false)
	components?.scheme = "googlechromes"
	return components?.url ?? httpsURL
}

/// The seams the UI-free web-auth core needs, injected so tests never launch a
/// browser or hit the network: where to persist the in-flight secrets, how to
/// open the authorize URL, and how to exchange the returned code. `openAuthorizeURL`
/// receives the raw https authorize URL; the Chrome-first rewrite and the
/// open-failure fallback live behind this seam in the App layer.
struct WebAuthFlowDependencies {
	let pendingStore: PendingAuthStore
	let openAuthorizeURL: (URL) -> Void
	let exchange: (_ callbackURL: URL, _ pending: PendingAuth) async -> Result<Void, Error>
}

/// The UI-free core of the external-browser auth flow, shared by Login and Sign
/// up (which differ only in the authorize request handed to `start`). `start` is
/// invoked from a button with a freshly-built request; `complete` from the
/// `readplace://oauth-callback` deep link (possibly in a fresh process after a
/// cold relaunch).
struct WebAuthFlow {
	let start: (AuthorizationRequest) -> Void
	/// Returns `nil` when there is no pending record (an unexpected deep link),
	/// otherwise the result of exchanging the returned code.
	let complete: (URL) async -> Result<Void, Error>?
}

/// Partial application (`init*`) wiring the injected seams into a `WebAuthFlow`.
func initWebAuthFlow(deps: WebAuthFlowDependencies) -> WebAuthFlow {
	WebAuthFlow(
		start: { request in
			// Persist BEFORE opening the browser: the app may be killed during the
			// external-browser hop, so the deep-link callback must be able to read
			// these back from a cold launch.
			deps.pendingStore.save(PendingAuth(
				verifier: request.codeVerifier,
				state: request.state,
				redirectURI: request.redirectURI
			))
			deps.openAuthorizeURL(request.url)
		},
		complete: { callbackURL in
			guard let pending = deps.pendingStore.load() else { return nil }
			deps.pendingStore.clear()
			return await deps.exchange(callbackURL, pending)
		}
	)
}
