import Foundation

enum APIError: LocalizedError {
	case noToken
	case unauthorized
	case server(status: Int, code: String?, message: String?)
	/// The server refused the request with messages for the client to render.
	/// Carries the server-authored messages; the refusal models no action — there
	/// is nothing for the client to invoke, only something for the user to read.
	case refused(messages: [ServerMessage])
	case decoding

	var errorDescription: String? {
		switch self {
		case .noToken: return "Not signed in. Open Readplace and sign in first."
		case .unauthorized: return "Your session expired. Please sign in again."
		case .server(let status, let code, let message):
			return message ?? "Server error \(status)\(code.map { " (\($0))" } ?? "")."
		case .refused(let messages): return messages.map(\.plainText).joined(separator: "\n")
		case .decoding: return "Could not read the server response."
		}
	}
}

/// One page of the reading-list collection plus the collection-level actions
/// and pagination links the server advertised.
struct QueuePage {
	let articles: [Article]
	let selfHref: String?
	let nextHref: String?
	let prevHref: String?
	/// Href of the server's "add links via Share" help page, advertised on the
	/// collection so the iOS client discovers it rather than hardcoding the path.
	let addLinksHelpHref: String?
	let total: Int?
	let saveArticleAction: SirenAction?
	let saveHtmlAction: SirenAction?
	let warning: SirenWarning?

	init(collection: SirenCollection) {
		articles = (collection.entities ?? []).compactMap(Article.init(entity:))
		selfHref = collection.links?.first { $0.rel.contains("self") }?.href
		nextHref = collection.links?.first { $0.rel.contains("next") }?.href
		prevHref = collection.links?.first { $0.rel.contains("prev") }?.href
		addLinksHelpHref = collection.links?.first { $0.rel.contains("add-links-help") }?.href
		total = collection.properties?.total
		saveArticleAction = collection.actions?.first { $0.name == "save-article" }
		saveHtmlAction = collection.actions?.first { $0.name == "save-html" }
		warning = collection.properties?.warning
	}
}

/// A Siren client for the Readplace reading list, replicating the browser
/// extension's walker: it speaks `application/vnd.siren+json`, presents a
/// Bearer token, refreshes once on `401`, and follows server-declared hrefs
/// rather than constructing them.
final class ReadplaceAPI {
	let baseURL: String
	private let store: TokenStore
	private let oauth: OAuthService
	private let session: URLSession

	// Defaults to an ephemeral configuration so the session's cookie jar is its
	// own isolated, in-memory store rather than process-wide `HTTPCookieStorage.shared`:
	// the `hutch_sid` cookie minted by `bootstrapSession` must not linger in the
	// shared jar where it would outlive the session and leak across sign-outs.
	init(baseURL: String, store: TokenStore, sessionConfiguration: URLSessionConfiguration = .ephemeral) {
		self.baseURL = baseURL
		self.store = store
		self.oauth = OAuthService(baseURL: baseURL, store: store, sessionConfiguration: sessionConfiguration)
		// URLSession retains its delegate until invalidated, so the redirect
		// handler stays alive for the session's lifetime.
		self.session = URLSession(
			configuration: sessionConfiguration,
			delegate: RedirectHeaderPreservingDelegate(),
			delegateQueue: nil
		)
	}

	// MARK: - Reading list

	/// Loads a collection page. With no `path`, starts at the entry point — the
	/// one URL the client knows — and follows wherever the server redirects;
	/// otherwise it follows a link href the server already handed back (e.g. the
	/// `next` link).
	func loadQueue(path: String? = nil) async throws -> QueuePage {
		let url: URL
		if let path {
			url = try absoluteURL(path)
		} else {
			guard let entry = URL(string: "\(baseURL)/") else { throw APIError.decoding }
			url = entry
		}
		var request = URLRequest(url: url)
		request.httpMethod = "GET"
		let (data, http) = try await send(request)
		guard http.statusCode == 200 else { throw apiError(from: data, status: http.statusCode) }
		return QueuePage(collection: try decode(SirenCollection.self, data))
	}

	/// Changes an item's reading status via its server-declared action — the
	/// action carries the href, method and field set the client follows rather
	/// than hand-building. The status is sent as the `status` field. The response
	/// is verified at the protocol level only: a successful follow (a 2xx/3xx,
	/// after the redirect-preserving delegate re-attaches auth across any
	/// redirect) confirms the change; anything else surfaces as a server error.
	/// The body is deliberately not consumed, so a caller's optimistic update is
	/// never rolled back by a 2xx whose shape this method doesn't read.
	func updateStatus(action: SirenAction, status: ArticleStatus) async throws {
		let request = formRequest(try absoluteURL(action.href), method: action.method,
			contentType: action.type ?? "application/x-www-form-urlencoded",
			fields: ["status": status.rawValue])
		let (data, http) = try await send(request)
		guard (200...399).contains(http.statusCode) else {
			throw apiError(from: data, status: http.statusCode)
		}
	}

	// MARK: - Reader session

	/// Mints a browser session cookie from the current bearer token via the
	/// session-bootstrap endpoint and returns it. The in-app reader injects the
	/// cookie so the cookie-authenticated reader page (and its in-reader XHRs)
	/// load without bouncing to a sign-in page. Reuses `send()`, so a stale bearer
	/// is refreshed once before the cookie is minted.
	func bootstrapSession() async throws -> HTTPCookie {
		guard let url = URL(string: "\(baseURL)/auth/session") else { throw APIError.decoding }
		var request = URLRequest(url: url)
		request.httpMethod = "POST"
		let (data, http) = try await send(request)
		guard (200...299).contains(http.statusCode) else {
			throw apiError(from: data, status: http.statusCode)
		}
		guard let cookie = sessionCookie(from: http, url: url) else { throw APIError.decoding }
		return cookie
	}

	/// Reads the session cookie by name from the session's own cookie jar, which
	/// the configuration isolates (an ephemeral store, not `HTTPCookieStorage.shared`)
	/// so the cookie URLSession just parsed never touches the process-wide jar.
	/// The cookie spec forbids folding repeated `Set-Cookie` headers into one
	/// comma-joined value, so re-splitting `allHeaderFields` is unsafe once a
	/// response sets more than one cookie; reading the already-parsed cookie back
	/// by name sidesteps that. Falls back to the response's own `Set-Cookie`
	/// header (reliable for a single cookie) for environments that don't populate
	/// the store.
	private func sessionCookie(from response: HTTPURLResponse, url: URL) -> HTTPCookie? {
		if let stored = session.configuration.httpCookieStorage?
			.cookies(for: url)?
			.first(where: { $0.name == AppConfig.sessionCookieName }) {
			return stored
		}
		guard let headers = response.allHeaderFields as? [String: String] else { return nil }
		return HTTPCookie.cookies(withResponseHeaderFields: headers, for: url)
			.first { $0.name == AppConfig.sessionCookieName }
	}

	// MARK: - Saving

	/// Saves a page using its pre-rendered HTML via the `save-html` action.
	/// On an error body that carries a fallback action (e.g. the payload is too
	/// large), it degrades to the URL-only path — dropping `rawHtml` — exactly
	/// like the extension client does.
	func saveHTML(
		action: SirenAction,
		url: String,
		rawHtml: String,
		title: String?
	) async throws -> Article {
		var body: [String: String] = ["url": url, "rawHtml": rawHtml]
		if let title, !title.isEmpty { body["title"] = title }
		let request = jsonRequest(try absoluteURL(action.href), method: action.method,
			contentType: action.type ?? "application/json", body: body)
		let (data, http) = try await send(request)
		if http.statusCode == 201 || http.statusCode == 200 {
			return try decodeArticle(data)
		}
		// The server may refuse with messages for the client to render (e.g. a
		// locked account). Surface them as .refused before the fallback below, so
		// a message-only refusal is never mistaken for a fallback action.
		if let refusal = refusalError(from: data) { throw refusal }
		if let sirenError = try? JSONDecoder().decode(SirenError.self, from: data),
			let fallback = sirenError.actions?.first {
			var fallbackBody: [String: String] = ["url": url]
			if let title, !title.isEmpty { fallbackBody["title"] = title }
			let fallbackRequest = jsonRequest(try absoluteURL(fallback.href), method: fallback.method,
				contentType: fallback.type ?? "application/json", body: fallbackBody)
			let (fbData, fbHTTP) = try await send(fallbackRequest)
			guard fbHTTP.statusCode == 201 || fbHTTP.statusCode == 200 else {
				throw apiError(from: fbData, status: fbHTTP.statusCode)
			}
			return try decodeArticle(fbData)
		}
		throw apiError(from: data, status: http.statusCode)
	}

	/// Saves a URL only (no captured HTML) via the `save-article` action.
	func saveArticle(action: SirenAction, url: String) async throws -> Article {
		var request = jsonRequest(try absoluteURL(action.href), method: action.method,
			contentType: action.type ?? "application/json", body: ["url": url])
		request.setValue("return=representation", forHTTPHeaderField: "Prefer")
		let (data, http) = try await send(request)
		guard http.statusCode == 201 || http.statusCode == 200 else {
			throw apiError(from: data, status: http.statusCode)
		}
		return try decodeArticle(data)
	}

	// MARK: - Transport

	private func send(_ request: URLRequest, retryOn401: Bool = true) async throws -> (Data, HTTPURLResponse) {
		guard let token = store.tokens?.accessToken else { throw APIError.noToken }
		var authed = request
		authed.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
		authed.setValue(AppConfig.sirenMediaType, forHTTPHeaderField: "Accept")
		// Identifies this request as coming from the iOS app so the server records
		// onboarding completion per-user (Safari on the same phone can't see the
		// app's cookies, so it can't rely on the extension's cookie signals).
		authed.setValue("ios", forHTTPHeaderField: "X-Readplace-Client")
		let (data, response) = try await session.data(for: authed)
		guard let http = response as? HTTPURLResponse else { throw APIError.decoding }
		if http.statusCode == 401 && retryOn401 {
			guard (try? await oauth.refresh()) != nil else { throw APIError.unauthorized }
			return try await send(request, retryOn401: false)
		}
		return (data, http)
	}

	private func jsonRequest(
		_ url: URL,
		method: String,
		contentType: String,
		body: [String: String]
	) -> URLRequest {
		var request = URLRequest(url: url)
		request.httpMethod = method
		request.setValue(contentType, forHTTPHeaderField: "Content-Type")
		request.httpBody = try? JSONSerialization.data(withJSONObject: body)
		return request
	}

	private func formRequest(
		_ url: URL,
		method: String,
		contentType: String,
		fields: [String: String]
	) -> URLRequest {
		var request = URLRequest(url: url)
		request.httpMethod = method
		request.setValue(contentType, forHTTPHeaderField: "Content-Type")
		var components = URLComponents()
		components.queryItems = fields.map { URLQueryItem(name: $0.key, value: $0.value) }
		request.httpBody = components.percentEncodedQuery.map { Data($0.utf8) }
		return request
	}

	/// Resolves a server-declared href to an absolute URL, throwing when the href
	/// is missing or names a scheme the client doesn't act on — an action the
	/// client can't follow is a decode-level failure, not a silent no-op.
	private func absoluteURL(_ href: String?) throws -> URL {
		guard let href, let url = Href.resolve(href, baseURL: baseURL) else { throw APIError.decoding }
		return url
	}

	private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
		guard let value = try? JSONDecoder().decode(type, from: data) else { throw APIError.decoding }
		return value
	}

	private func decodeArticle(_ data: Data) throws -> Article {
		let entity = try decode(SirenEntity.self, data)
		guard let article = Article(entity: entity) else { throw APIError.decoding }
		return article
	}

	private func apiError(from data: Data, status: Int) -> APIError {
		if status == 401 { return .unauthorized }
		if let refusal = refusalError(from: data) { return refusal }
		if let sirenError = try? JSONDecoder().decode(SirenError.self, from: data) {
			return .server(status: status, code: sirenError.properties.code, message: sirenError.properties.message)
		}
		return .server(status: status, code: nil, message: nil)
	}

	/// Decodes a message-only refusal (e.g. a locked account), or nil when the
	/// body isn't one. Detected before the generic server error (and before the
	/// save-html fallback) so the refusal surfaces as `.refused` rather than a
	/// generic save failure. The refusal carries no action — nothing to follow.
	///
	/// Messages whose media type the client can't render are dropped (be liberal
	/// in what you accept, conservative in what you render); a refusal left with no
	/// renderable message is treated as not-a-refusal so it never shows blank.
	private func refusalError(from data: Data) -> APIError? {
		guard let sirenError = try? JSONDecoder().decode(SirenError.self, from: data),
			let messages = sirenError.properties.messages
		else { return nil }
		let renderable = messages.filter(\.isRenderable)
		guard !renderable.isEmpty else { return nil }
		return .refused(messages: renderable)
	}
}

/// Re-attaches `Authorization`, `Accept` and `X-Readplace-Client` to redirected
/// requests. URLSession strips `Authorization` on cross-origin redirects and may
/// drop custom headers generally; the entry point `GET /` → `303 /queue` needs
/// them preserved (the client header so onboarding step 1 is recorded on the
/// post-redirect `/queue` load).
private final class RedirectHeaderPreservingDelegate: NSObject, URLSessionTaskDelegate {
	func urlSession(
		_ session: URLSession,
		task: URLSessionTask,
		willPerformHTTPRedirection response: HTTPURLResponse,
		newRequest request: URLRequest,
		completionHandler: @escaping (URLRequest?) -> Void
	) {
		var updated = request
		for header in ["Authorization", "Accept", "X-Readplace-Client"] {
			if let value = task.originalRequest?.value(forHTTPHeaderField: header) {
				updated.setValue(value, forHTTPHeaderField: header)
			}
		}
		completionHandler(updated)
	}
}
