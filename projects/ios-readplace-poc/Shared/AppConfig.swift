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

/// Central configuration for the Readplace iOS POC.
///
/// The app reuses the existing public OAuth/PKCE client registered on the
/// server (`hutch-chrome-extension`) and a registered HTTPS callback URL, so it
/// talks to the server exactly like the browser extension does. The production
/// build needs no server-side change; the staging build relies on the staging
/// callback listed in the server's
/// `src/packages/domain/src/oauth/built-in-clients.ts`.
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

	/// A registered public PKCE client. `https://readplace.com/oauth/callback`
	/// is one of its allow-listed redirect URIs, which is what makes the
	/// in-app WKWebView interception strategy work without a server change.
	static let clientId = "hutch-chrome-extension"

	/// The Siren hypermedia media type the API speaks.
	static let sirenMediaType = "application/vnd.siren+json"

	/// Shared container so the app (which signs in) and the share extension
	/// (which saves) can both read the OAuth tokens.
	///
	/// This must match the App Groups entitlement on BOTH targets and the App
	/// Group identifier registered in the Apple Developer portal, otherwise the
	/// extension cannot read the token the app stores.
	static let appGroupId = "group.com.readplace"

	/// Path appended to the base URL to form the registered redirect URI.
	static let callbackPath = "/oauth/callback"

	/// Custom URL scheme the OS routes back to this app. Declared in
	/// `Info.plist`'s `CFBundleURLTypes`; used by the external-browser "Sign up"
	/// flow, which (unlike the in-app WKWebView login) can't observe an https
	/// redirect in another app's tab.
	static let callbackURLScheme = "readplace"

	/// Native redirect URI for the external-browser Sign up flow. Registered on
	/// the `hutch-chrome-extension` client in the server's
	/// `src/packages/domain/src/oauth/built-in-clients.ts`; it must match there
	/// exactly because the OAuth server checks `redirect_uri` by exact string at
	/// both authorize and token time.
	static let nativeCallbackURL = "\(callbackURLScheme)://oauth-callback"

	/// A Safari-like user agent. Embedded WKWebViews are sometimes refused by
	/// Google's sign-in ("disallowed_useragent"); presenting a stock Safari UA
	/// avoids that. Email/password sign-in works regardless.
	static let webViewUserAgent =
		"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
		+ "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
}
