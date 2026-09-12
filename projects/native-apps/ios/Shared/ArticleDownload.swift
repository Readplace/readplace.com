import Foundation

/// Recognises one of *our own* article-file links (`/view/<url>?format=epub`).
///
/// Every other tapped link leaves the app: an article's own links go to the
/// system, and a readplace.com content link goes to Chrome so it meets the web
/// session the user already has there (`chromeURLFor`). A download has no such
/// reason to leave. Handing it to a browser would drop the reader the user was
/// reading, so the reader keeps it: WebKit fetches the file and the app offers it
/// to the share sheet, which is where Books and Files are reachable from.
///
/// Scoped to our host for the same reason the Chrome rewrite is — a `format=epub`
/// query on someone else's site is their route, not ours, and claiming it would
/// break a link the app has no business interpreting.
func isArticleDownloadURL(_ url: URL) -> Bool {
	guard url.host == AppConfig.serverHost else { return false }
	let queryItems = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
	return queryItems.contains { $0.name == "format" && $0.value == "epub" }
}

/// Where a finished download is written before the share sheet takes it.
///
/// WebKit's suggested filename comes from the server's `Content-Disposition`, so
/// it carries the article's title and is what the share sheet shows. It is still
/// server-supplied text reaching the filesystem, so the last path component is
/// all that survives: a name carrying `/` or `..` must not be able to pick the
/// directory it lands in. An empty or dot-only remainder falls back to a fixed
/// name rather than writing to the directory itself.
func articleDownloadDestination(suggestedFilename: String, in directory: URL) -> URL {
	let lastComponent = suggestedFilename.split(separator: "/").last.map(String.init) ?? ""
	let safeName = lastComponent.trimmingCharacters(in: CharacterSet(charactersIn: ". "))
	return directory.appendingPathComponent(safeName.isEmpty ? "article.epub" : safeName)
}
