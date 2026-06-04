import Foundation

/// Central configuration for the Readplace iOS POC.
///
/// The app reuses the existing public OAuth/PKCE client registered on the
/// server (`hutch-chrome-extension`) and the registered HTTPS callback URL,
/// so it talks to production exactly like the browser extension does — no
/// server-side changes are required. See the server's
/// `src/packages/test-fixtures/src/providers/oauth/oauth-clients.ts`.
enum AppConfig {
	/// Default server. Overridable at runtime on the login screen and persisted
	/// in the shared App Group so the share extension targets the same server.
	static let defaultBaseURL = "https://readplace.com"

	/// A registered public PKCE client. `https://readplace.com/oauth/callback`
	/// is one of its allow-listed redirect URIs, which is what makes the
	/// in-app WKWebView interception strategy work without a server change.
	static let clientId = "hutch-chrome-extension"

	/// The Siren hypermedia media type the API speaks.
	static let sirenMediaType = "application/vnd.siren+json"

	/// Shared container so the app (which signs in) and the share extension
	/// (which saves) can both read the OAuth tokens and the base URL.
	///
	/// This must match the App Groups entitlement on BOTH targets. App Groups
	/// work with a free personal Apple ID team — if Xcode shows a provisioning
	/// error, confirm both targets declare this exact group and let Xcode
	/// register it.
	static let appGroupId = "group.com.fagnerbrack.readplacepoc"

	/// Path appended to the base URL to form the registered redirect URI.
	static let callbackPath = "/oauth/callback"

	/// A Safari-like user agent. Embedded WKWebViews are sometimes refused by
	/// Google's sign-in ("disallowed_useragent"); presenting a stock Safari UA
	/// avoids that. Email/password sign-in works regardless.
	static let webViewUserAgent =
		"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
		+ "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
}
