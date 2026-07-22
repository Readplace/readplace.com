import AuthenticationServices
import UIKit

/// The browser seam the app opens external *content* URLs through, kept in the App
/// target so the tested cores stay free of UIKit. `.system` uses the live
/// `UIApplication`; tests inject their own closure. `open` mirrors
/// `UIApplication.open(_:options:completionHandler:)` — its `Bool` reports whether
/// the system accepted the URL, which the Chrome-first flow needs to decide
/// whether to fall back.
struct ExternalBrowser {
	let open: (_ url: URL, _ completion: @escaping (Bool) -> Void) -> Void

	static let system = ExternalBrowser(
		open: { url, completion in UIApplication.shared.open(url, options: [:], completionHandler: completion) }
	)
}

/// Opens a content URL Chrome-first *when it is one of ours*: `chromeURLFor`
/// rewrites a readplace.com URL to Chrome's scheme so it lands in the browser where
/// the user already has a Readplace web session. Only when the system reports
/// Chrome could not be opened (Chrome not installed) does it fall back to the
/// original URL in the default browser — never as the default path, because most
/// users keep Safari as the iOS default yet are signed in only in Chrome.
///
/// Every external content open goes through here, so the rule lives in one place:
/// the changelog banner's "Read more" is ours and gets Chrome; a link to someone
/// else's site is handed to the system untouched, which keeps Universal Links
/// resolving to native apps and respects the user's default browser. `chromeURLFor`
/// owns that distinction — see it for why, including why signing in is not routed
/// through here.
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

/// Presents `/oauth/authorize` in an `ASWebAuthenticationSession`: an in-app
/// browser that captures the `readplace://oauth-callback` redirect itself, so
/// signing in never hands the user to a separate browser app — which is what App
/// Store review rejected. It also reuses Safari's shared cookie jar, so a user
/// already signed in there passes straight through.
///
/// The session is held for the life of the presentation because
/// `ASWebAuthenticationSession` cancels itself once its last reference drops.
@MainActor
final class InAppAuthSession: NSObject, ASWebAuthenticationPresentationContextProviding {
	private var session: ASWebAuthenticationSession?

	func present(_ authorizeURL: URL) async -> Result<WebAuthPresentation, Error> {
		await withCheckedContinuation { continuation in
			let session = ASWebAuthenticationSession(
				url: authorizeURL,
				callbackURLScheme: AppConfig.callbackURLScheme
			) { callbackURL, error in
				continuation.resume(returning: authPresentationOutcome(callbackURL: callbackURL, error: error))
			}
			session.presentationContextProvider = self
			self.session = session
			// A refused start never calls the completion handler, so this is the only
			// place that resumption can come from.
			guard session.start() else {
				self.session = nil
				continuation.resume(returning: .failure(AuthFlowError.presentationFailed))
				return
			}
		}
	}

	func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
		let keyWindow = UIApplication.shared.connectedScenes
			.compactMap { $0 as? UIWindowScene }
			.flatMap(\.windows)
			.first(where: \.isKeyWindow)
		guard let keyWindow else {
			// A detached fallback window would present an invisible sheet; a Login
			// tap implies a foreground scene, so no key window is a broken invariant.
			preconditionFailure("auth presentation requires a foreground key window")
		}
		return keyWindow
	}
}

/// Composition root for the in-app auth flow shared by Login and Sign up: wires a
/// fresh auth-session presenter and the live session's token exchange into a
/// `WebAuthFlow`. The presenter is retained by the returned flow's closures, which
/// is what keeps it alive across the `await`.
@MainActor
func makeWebAuthFlow(session: AppSession) -> WebAuthFlow {
	let presenter = InAppAuthSession()
	return initWebAuthFlow(deps: WebAuthFlowDependencies(
		present: { authorizeURL in await presenter.present(authorizeURL) },
		exchange: { callbackURL, request in
			await session.completeSignIn(
				callbackURL: callbackURL,
				verifier: request.codeVerifier,
				expectedState: request.state,
				redirectURI: request.redirectURI
			)
		}
	))
}
