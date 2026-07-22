import Foundation

/// What the in-app auth session returned: the `readplace://oauth-callback` URL it
/// captured, or the user dismissing it. A dismissal is a choice rather than a
/// fault, so it is a success case here and never becomes an error the sign-in
/// screen shows.
enum WebAuthPresentation: Equatable {
	case returned(callbackURL: URL)
	case dismissed
}

/// The seams the UI-free web-auth core needs, injected so tests never present a
/// browser or hit the network: how to show the authorize URL and capture the
/// callback it redirects to, and how to exchange the code that comes back.
struct WebAuthFlowDependencies {
	let present: (URL) async -> Result<WebAuthPresentation, Error>
	let exchange: (_ callbackURL: URL, _ request: AuthorizationRequest) async -> Result<Void, Error>
}

/// The UI-free core of the in-app auth flow, shared by Login and Sign up, which
/// differ only in the authorize request handed to `start`. One `await` spans the
/// whole attempt because the auth session hands the callback back to its caller
/// instead of routing it through the app's URL handler — so the PKCE verifier
/// lives in this call's scope and never reaches disk.
struct WebAuthFlow {
	/// `nil` when the user dismissed the auth session.
	let start: (AuthorizationRequest) async -> Result<Void, Error>?
}

/// Partial application (`init*`) wiring the injected seams into a `WebAuthFlow`.
func initWebAuthFlow(deps: WebAuthFlowDependencies) -> WebAuthFlow {
	WebAuthFlow(
		start: { request in
			switch await deps.present(request.url) {
			case .failure(let error):
				return .failure(error)
			case .success(.dismissed):
				return nil
			case .success(.returned(let callbackURL)):
				return await deps.exchange(callbackURL, request)
			}
		}
	)
}
