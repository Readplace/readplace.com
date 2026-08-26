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
		// endpoint (pulumi stack output appOrigin --stack staging). Keep in sync
		// with the server's OAuth client registration if the gateway is replaced.
		case .staging: return "https://hkncrxpii6.execute-api.ap-southeast-2.amazonaws.com"
		}
	}
}

/// Central configuration for the Readplace iOS app.
///
/// The app authenticates with its own dedicated public OAuth/PKCE client
/// (`ios-app`) registered on the server, and talks to the Siren API
/// like the browser extension. The native `readplace://oauth-callback` redirect
/// is registered on that client and is identical across production and staging,
/// so sign-in needs no per-environment callback registration.
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

	/// The one host whose links are opened Chrome-first (see `chromeURLFor`).
	/// Force-unwrap is safe: both operands are compile-time constants.
	static let serverHost = URL(string: serverBaseURL)!.host!

	/// A registered public PKCE client whose allow-listed redirect URIs include the
	/// native `readplace://oauth-callback` redirect the auth flow returns through.
	static let clientId = "ios-app"

	static let sirenMediaType = "application/vnd.siren+json"

	/// Tells the server this build's saves survive the share sheet — the content
	/// upload runs on a background session — so it drops the notice asking the user
	/// not to close it. The server never advertises the header: a shipped build that
	/// predates the background leg simply never sends it and keeps the notice, for
	/// which it is still true.
	static let saveContinuityHeader = "X-Readplace-Save-Continuity"
	static let saveContinuityBackground = "background"

	/// Identifies the native app to the server, which keys onboarding signals and
	/// the save notice off it; Safari on the same phone can never send it.
	static let clientHeader = "X-Readplace-Client"
	static let clientIos = "ios"

	/// The public privacy policy served by the web app, linked from the sign-in
	/// screen so the policy is reachable in-app (App Store Review Guideline
	/// 5.1.1(i)). Force-unwrap is safe: both operands are compile-time constants.
	static let privacyPolicyURL = URL(string: "\(serverBaseURL)/privacy")!

	/// Path of the server's "add links via Share" help page, opened by the reading
	/// list's client-side add (+) control. The page is a real server route, but the
	/// client holds the path itself so the control works without the server
	/// advertising it as a Siren link.
	static let addLinksHelpPath = "/help/add-links"

	/// Path of the server's slogan list, rendered on the sign-in screen. Held by the
	/// client rather than discovered, because sign-in is the one screen that runs
	/// before there is a session to walk the Siren entry point with.
	static let slogansPath = "/slogans"

	/// Shown until the fetched list arrives, and kept if it never does. Sign-in is
	/// the app's first screen and often its first network call, so the slogan cannot
	/// depend on that call succeeding. It matches the first entry the server
	/// publishes; the server list is what changes without an App Store release.
	static let fallbackSlogan = "Your #1 AI-Powered Reading List."

	/// Query item the in-app reader appends to the server `read` link so the reader
	/// renders chromeless — bare of the web shell — with the native reading list as
	/// its chrome. An explicit client-sent signal, never a user-agent sniff.
	static let readerPlatformQueryItem = URLQueryItem(name: "platform", value: "ios")

	/// Capability marker the app appends to any href it opens in its web sheet: it
	/// tells the server this build hosts the page in a WKWebView whose navigation
	/// delegate intercepts `readplace://` deep links, so the server may answer with
	/// one (the account page's chromeless back link and its post-delete sign-out).
	/// The server never advertises it — an older build, which cannot deploy in
	/// lockstep with the server, simply never sends it and keeps the ordinary web
	/// shell it can already drive.
	static let appShellQueryItem = URLQueryItem(name: "shell", value: "app")

	/// Shared container so the app (which signs in) and the share extension
	/// (which saves) can both read the OAuth tokens.
	///
	/// This must match the App Groups entitlement on BOTH targets and the App
	/// Group identifier registered in the Apple Developer portal, otherwise the
	/// extension cannot read the token the app stores.
	static let appGroupId = "group.com.readplace"

	/// Custom URL scheme the auth flow redirects to. Handed to
	/// `ASWebAuthenticationSession` as its `callbackURLScheme`, which is how the
	/// in-app session recognises the redirect as the end of the flow and captures it
	/// in-process instead of letting it leave the app.
	static let callbackURLScheme = "readplace"

	/// Host component of `nativeCallbackURL`, kept separate so the registered URI is
	/// composed from its parts rather than repeated as a second literal.
	static let nativeCallbackHost = "oauth-callback"

	/// Native redirect URI for the Login and Sign up flows, composed from the scheme
	/// + host above. Must equal the redirect URI registered for this client on the
	/// server — the OAuth server matches `redirect_uri` by exact string at authorize
	/// and token time — and a test pins the value so a change fails a test.
	static let nativeCallbackURL = "\(callbackURLScheme)://\(nativeCallbackHost)"

	/// A Safari-like user agent for the off-screen `WKWebView` that `HTMLCaptor`
	/// uses to render article pages for capture. A stock Safari UA gets sites to
	/// serve their normal page rather than refusing or degrading content for an
	/// unrecognised embedded web view.
	static let webViewUserAgent =
		"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
		+ "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
}
