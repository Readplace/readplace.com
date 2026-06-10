import Foundation

enum APIError: LocalizedError {
	case noToken
	case unauthorized
	case notFound
	case server(status: Int, code: String?, message: String?)
	/// The account is locked (email never verified within the window). Carries
	/// the server's message — the refusal models no action, so the UI shows the
	/// message (which itself names the address to email) rather than a button.
	case accountLocked(message: String)
	case decoding

	var errorDescription: String? {
		switch self {
		case .noToken: return "Not signed in. Open Readplace and sign in first."
		case .unauthorized: return "Your session expired. Please sign in again."
		case .notFound: return "That item no longer exists."
		case .server(let status, let code, let message):
			return message ?? "Server error \(status)\(code.map { " (\($0))" } ?? "")."
		case .accountLocked(let message): return message
		case .decoding: return "Could not read the server response."
		}
	}
}

/// The Siren error `code` the server uses for a locked-account refusal. Stable
/// contract shared with the browser extension; see the extension-api-design skill.
private let accountLockedCode = "account-locked"

/// One page of the reading-list collection plus the collection-level actions
/// and pagination links the server advertised.
struct QueuePage {
	let articles: [Article]
	let selfHref: String?
	let nextHref: String?
	let prevHref: String?
	let total: Int?
	let saveArticleAction: SirenAction?
	let saveHtmlAction: SirenAction?
	let warning: SirenWarning?

	init(collection: SirenCollection) {
		articles = (collection.entities ?? []).compactMap(Article.init(entity:))
		selfHref = collection.links?.first { $0.rel.contains("self") }?.href
		nextHref = collection.links?.first { $0.rel.contains("next") }?.href
		prevHref = collection.links?.first { $0.rel.contains("prev") }?.href
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

	init(baseURL: String, store: TokenStore, sessionConfiguration: URLSessionConfiguration = .default) {
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

	/// Loads a collection page. With no `path`, starts at the entry point `/`
	/// (the server 303-redirects to `/queue`); otherwise follows a declared
	/// link href (e.g. the `next` link).
	func loadQueue(path: String? = nil) async throws -> QueuePage {
		let target = path.map(absolute) ?? "\(baseURL)/"
		guard let url = URL(string: target) else { throw APIError.decoding }
		var request = URLRequest(url: url)
		request.httpMethod = "GET"
		let (data, http) = try await send(request)
		guard http.statusCode == 200 else { throw apiError(from: data, status: http.statusCode) }
		return QueuePage(collection: try decode(SirenCollection.self, data))
	}

	/// Deletes an item via its server-declared `delete` href and returns the
	/// refreshed collection the server redirects back to.
	func delete(href: String) async throws -> QueuePage {
		guard let url = URL(string: absolute(href)) else { throw APIError.decoding }
		var request = URLRequest(url: url)
		request.httpMethod = "POST"
		request.setValue("return=representation", forHTTPHeaderField: "Prefer")
		let (data, http) = try await send(request)
		if http.statusCode == 404 { throw APIError.notFound }
		guard (200...299).contains(http.statusCode) else {
			throw apiError(from: data, status: http.statusCode)
		}
		return QueuePage(collection: try decode(SirenCollection.self, data))
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
		let request = try jsonRequest(absolute(action.href), method: action.method,
			contentType: action.type ?? "application/json", body: body)
		let (data, http) = try await send(request)
		if http.statusCode == 201 || http.statusCode == 200 {
			return try decodeArticle(data)
		}
		// A locked account is refused here too — surface it (with the unlock
		// action) rather than following the unlock action as a save fallback.
		if let locked = accountLockedError(from: data) { throw locked }
		if let sirenError = try? JSONDecoder().decode(SirenError.self, from: data),
			let fallback = sirenError.actions?.first {
			var fallbackBody: [String: String] = ["url": url]
			if let title, !title.isEmpty { fallbackBody["title"] = title }
			let fallbackRequest = try jsonRequest(absolute(fallback.href), method: fallback.method,
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
		var request = try jsonRequest(absolute(action.href), method: action.method,
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
		let (data, response) = try await session.data(for: authed)
		guard let http = response as? HTTPURLResponse else { throw APIError.decoding }
		if http.statusCode == 401 && retryOn401 {
			guard (try? await oauth.refresh()) != nil else { throw APIError.unauthorized }
			return try await send(request, retryOn401: false)
		}
		return (data, http)
	}

	private func jsonRequest(
		_ urlString: String,
		method: String,
		contentType: String,
		body: [String: String]
	) throws -> URLRequest {
		guard let url = URL(string: urlString) else { throw APIError.decoding }
		var request = URLRequest(url: url)
		request.httpMethod = method
		request.setValue(contentType, forHTTPHeaderField: "Content-Type")
		request.httpBody = try? JSONSerialization.data(withJSONObject: body)
		return request
	}

	private func absolute(_ href: String) -> String {
		if href.hasPrefix("http") { return href }
		if href.hasPrefix("/") { return "\(baseURL)\(href)" }
		return "\(baseURL)/\(href)"
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
		if let locked = accountLockedError(from: data) { return locked }
		if let sirenError = try? JSONDecoder().decode(SirenError.self, from: data) {
			return .server(status: status, code: sirenError.properties.code, message: sirenError.properties.message)
		}
		return .server(status: status, code: nil, message: nil)
	}

	/// Decodes a locked-account refusal, or nil when the body isn't one. Detected
	/// before the generic server error (and before the save-html fallback) so the
	/// refusal surfaces as its own case rather than a generic save failure.
	private func accountLockedError(from data: Data) -> APIError? {
		guard let sirenError = try? JSONDecoder().decode(SirenError.self, from: data),
			sirenError.properties.code == accountLockedCode
		else { return nil }
		return .accountLocked(message: sirenError.properties.message)
	}
}

/// Re-attaches `Authorization` and `Accept` to redirected requests. URLSession
/// strips `Authorization` on cross-origin redirects and may drop custom headers
/// generally; the entry point `GET /` → `303 /queue` needs them preserved.
private final class RedirectHeaderPreservingDelegate: NSObject, URLSessionTaskDelegate {
	func urlSession(
		_ session: URLSession,
		task: URLSessionTask,
		willPerformHTTPRedirection response: HTTPURLResponse,
		newRequest request: URLRequest,
		completionHandler: @escaping (URLRequest?) -> Void
	) {
		var updated = request
		for header in ["Authorization", "Accept"] {
			if let value = task.originalRequest?.value(forHTTPHeaderField: header) {
				updated.setValue(value, forHTTPHeaderField: header)
			}
		}
		completionHandler(updated)
	}
}
