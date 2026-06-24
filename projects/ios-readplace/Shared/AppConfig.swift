import Foundation

/// Maps each deployment to its server base URL. Kept data-driven (a value per
/// case, not an `#if` at the call site) so `AppConfigTests` can assert both
/// branches in one test build, whichever compilation condition is active.
enum ServerEnvironment {
	case production
	case staging

	var baseURL: String {
		switch self {
		case .production: return "https://readplace.com"
		// Staging has no custom domain; this is the staging stack's API Gateway
		// endpoint (pulumi stack output appOrigin --stack staging). Update here +
		// in built-in-clients.ts if the gateway is ever replaced (new api id).
		case .staging: return "https://hkncrxpii6.execute-api.ap-southeast-2.amazonaws.com"
		}
	}
}

/// Central configuration for the Readplace iOS app.
///
/// The app reuses the server's existing public OAuth/PKCE client
/// (`hutch-chrome-extension`) and talks to the Siren API like the browser
/// extension. The native `readplace://oauth-callback` redirect is registered on
/// that client in `built-in-clients.ts` and is identical across production and
/// staging, so sign-in needs no per-environment callback registration.
enum AppConfig {
	/// The server this build targets, fixed at compile time. Builds with the
	/// `STAGING` Swift compilation condition select staging; every other build
	/// is production. There is no runtime override.
	#if STAGING
	static let serverEnvironment: ServerEnvironment = .staging
	#else
	static let serverEnvironment: ServerEnvironment = .production
	#endif
	static let serverBaseURL = serverEnvironment.baseURL

	/// A registered public PKCE client whose allow-listed redirect URIs include the
	/// native `readplace://oauth-callback` deep link the auth flow returns through.
	static let clientId = "hutch-chrome-extension"

	/// The Siren hypermedia media type the API speaks.
	static let sirenMediaType = "application/vnd.siren+json"

	/// Name of the server's browser session cookie (`hutch_sid`). Minted from a
	/// bearer token via `POST /auth/session` and injected into the in-app reader
	/// webview so its cookie-authenticated pages load. Must match the server's
	/// `SESSION_COOKIE_NAME`.
	static let sessionCookieName = "hutch_sid"

	/// Shared container so the app (which signs in) and the share extension
	/// (which saves) can both read the OAuth tokens.
	///
	/// This must match the App Groups entitlement on BOTH targets and the App
	/// Group identifier registered in the Apple Developer portal, otherwise the
	/// extension cannot read the token the app stores.
	static let appGroupId = "group.com.readplace"

	/// Custom URL scheme the OS routes back to this app. Declared in
	/// `Info.plist`'s `CFBundleURLTypes`; used by the external-browser auth flow
	/// (both Login and Sign up) to receive the OAuth redirect, since a web flow
	/// running in another app's browser can't be observed in-process.
	static let callbackURLScheme = "readplace"

	/// Host component of `nativeCallbackURL`. `RootView.onOpenURL` matches the
	/// incoming deep link's host against this constant, so the registered URI and
	/// the deep-link parse site share one source instead of two equal literals.
	static let nativeCallbackHost = "oauth-callback"

	/// Native redirect URI for the external-browser Sign up flow, composed from
	/// the scheme + host above so what we register can't disagree with what the
	/// deep-link handler accepts. Must equal `IOS_NATIVE_OAUTH_CALLBACK_URI` in
	/// the server's `src/packages/domain/src/oauth/built-in-clients.ts` — the
	/// OAuth server matches `redirect_uri` by exact string at authorize and token
	/// time — and `SignupFlowTests` pins the value so a change fails a test.
	static let nativeCallbackURL = "\(callbackURLScheme)://\(nativeCallbackHost)"

	/// A Safari-like user agent for the off-screen `WKWebView` that `HTMLCaptor`
	/// uses to render article pages for capture. A stock Safari UA gets sites to
	/// serve their normal page rather than refusing or degrading content for an
	/// unrecognised embedded web view.
	static let webViewUserAgent =
		"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
		+ "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
}
