import Foundation

/// Rewrites one of *our own* web URLs to Chrome's scheme so the OS opens it in
/// Chrome, which shares one cookie jar across scheme-opened tabs and so reuses the
/// user's existing Readplace web session. Host, path and query are preserved.
/// Chrome documents `googlechrome://` for http and `googlechromes://` for https,
/// so the scheme is mapped rather than assumed.
///
/// This is for *content* links the app hands to a browser — the changelog banner's
/// "Read more", an article's own links. Signing in does not come through here: it
/// runs in an in-app auth session, because App Store review rejects handing the
/// user to a separate browser app to authenticate.
///
/// Returns nil — meaning "open this untouched" — for anything else, and the two
/// exclusions are the whole point of this function:
///
///   - **A host that is not ours.** Session reuse is the sole justification for
///     overriding the user's browser, and there is no Readplace session on
///     nytimes.com. Worse, a custom scheme can never be claimed by a Universal
///     Link, so rewriting a third-party link would stop `apps.apple.com`,
///     `youtube.com`, or `x.com` from handing off to their native apps, and would
///     silently override a default browser the user deliberately chose.
///   - **A non-http(s) scheme** (`mailto:`, `tel:`). Stamping `googlechromes` on
///     those yields a URL nothing can open.
///
/// For the URLs it *does* rewrite, the rewrite is unconditional: whether Chrome
/// can actually be opened is left to the system when the App seam opens the URL
/// (via the open completion handler), not to a `canOpenURL` pre-check — a
/// false-negative probe must never silently route the user into the default
/// browser (Safari), where they aren't signed in.
func chromeURLFor(_ url: URL) -> URL? {
	guard url.host == AppConfig.serverHost else { return nil }

	let chromeScheme: String
	switch url.scheme?.lowercased() {
	case "https": chromeScheme = "googlechromes"
	case "http": chromeScheme = "googlechrome"
	default: return nil
	}
	var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
	components?.scheme = chromeScheme
	return components?.url
}
