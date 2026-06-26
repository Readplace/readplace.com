import Foundation

enum APIError: LocalizedError {
	case noToken
	case unauthorized
	case server(status: Int, code: String?, message: String?)
	/// The server refused the request with messages for the client to render.
	/// Carries the server-authored messages; the refusal models no action — there
	/// is nothing for the client to invoke, only something for the user to read.
	case refused(messages: [ServerMessage])
	/// The response carried a body in a media type the client doesn't speak (not
	/// the negotiated Siren type). Surfaced honestly rather than blind-decoded — a
	/// proxy login page or a future media type is "I don't understand this," not a
	/// generic "couldn't read the response."
	case unsupportedMediaType(String?)
	case decoding

	var errorDescription: String? {
		switch self {
		case .noToken: return "Not signed in. Open Readplace and sign in first."
		case .unauthorized: return "Your session expired. Please sign in again."
		case .server(let status, let code, let message):
			return message ?? "Server error \(status)\(code.map { " (\($0))" } ?? "")."
		case .refused(let messages): return messages.map(\.plainText).joined(separator: "\n")
		case .unsupportedMediaType: return "The server replied in a format this app doesn't understand."
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
	/// Every collection-level action and navigable link the server advertised, in
	/// wire order — the complete set, so the share-sheet save journey can still find
	/// its bespoke action by name (`action(named:)`, below). The toolbar does not
	/// render this set verbatim: it derives its own subset client-side
	/// (`toolbarAffordances`) by mapping each affordance's wire token to its
	/// presentation and dropping the ones it can't present as a toolbar control —
	/// a structural navigation link the client follows itself, or a capture-only
	/// save iOS can only reach through the Share Sheet.
	let affordances: [Affordance]
	let warning: SirenWarning?

	init(collection: SirenCollection) {
		articles = (collection.entities ?? []).compactMap(Article.init(entity:))
		let links = collection.links ?? []
		selfHref = links.first { $0.rel.contains("self") }?.href
		nextHref = links.first { $0.rel.contains("next") }?.href
		prevHref = links.first { $0.rel.contains("prev") }?.href
		addLinksHelpHref = links.first { $0.rel.contains("add-links-help") }?.href
		total = collection.properties?.total
		let actionAffordances = (collection.actions ?? []).compactMap(Affordance.init(action:))
		let linkAffordances = links.compactMap(Affordance.init(link:))
		affordances = actionAffordances + linkAffordances
		warning = collection.properties?.warning
	}

	/// The advertised action with this name, when present and invokable. The
	/// share-sheet save journey needs a specific action to build its bespoke body
	/// (a captured-HTML or URL-only POST), which is the contract's sanctioned
	/// exception for actions with special bodies — distinct from the looped
	/// toolbar rendering, which never selects an affordance by name.
	func action(named name: String) -> SirenAction? {
		for affordance in affordances {
			if let action = affordance.action, action.name == name { return action }
		}
		return nil
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
		return QueuePage(collection: try decodeSiren(SirenCollection.self, data: data, response: http))
	}

	/// Invokes a simple entity action via its own server-declared href, method and
	/// type — the single generic path for actions whose body is a flat field set
	/// (e.g. `update-status`, `delete`), so a newly-advertised entity action is
	/// invokable with no new per-operation code. The caller supplies values only
	/// for the field names whose semantics the protocol fixes (`status`); the
	/// action's own declared field defaults fill the rest, and a field the caller
	/// neither supplies nor the server defaults is simply omitted. The body is
	/// verified at the protocol level only: a successful follow (a 2xx/3xx, after
	/// the redirect-preserving delegate re-attaches auth across any redirect)
	/// confirms it; anything else surfaces as a server error. The response body is
	/// deliberately not consumed, so a caller's optimistic update is never rolled
	/// back by a 2xx whose shape this method doesn't read.
	func invoke(action: SirenAction, values: [String: String] = [:]) async throws {
		var fields = values
		for declared in action.fields ?? [] where fields[declared.name] == nil {
			if let value = declared.value { fields[declared.name] = value }
		}
		let request = formRequest(try absoluteURL(action.href), method: action.method,
			contentType: action.type ?? "application/x-www-form-urlencoded",
			fields: fields)
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

	/// The article a save produced, plus whether the captured HTML reached the
	/// server or the request fell back to the URL-only path the server advertised.
	struct SaveResult {
		let article: Article
		let usedFallback: Bool
	}

	/// Saves a page using its pre-rendered HTML via the supplied action. On an
	/// error body that carries a fallback action (the server's chosen URL-only
	/// path, e.g. when the payload exceeds the server's cap), it follows that
	/// action — dropping `rawHtml` — exactly like the extension client does. The
	/// client never decides itself whether the HTML is acceptable; it attempts the
	/// save and follows the server's refusal.
	func saveHTML(
		action: SirenAction,
		url: String,
		rawHtml: String,
		title: String?
	) async throws -> SaveResult {
		var body: [String: String] = ["url": url, "rawHtml": rawHtml]
		if let title, !title.isEmpty { body["title"] = title }
		let request = jsonRequest(try absoluteURL(action.href), method: action.method,
			contentType: action.type ?? "application/json", body: body)
		let (data, http) = try await send(request)
		if http.statusCode == 201 || http.statusCode == 200 {
			return SaveResult(article: try decodeArticle(data, response: http), usedFallback: false)
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
			return SaveResult(article: try decodeArticle(fbData, response: fbHTTP), usedFallback: true)
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
		return try decodeArticle(data, response: http)
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
		let queryItems = fields.map { URLQueryItem(name: $0.key, value: $0.value) }
		// A GET carries no body — the field values are the query string, so encode
		// them onto the URL and send no Content-Type. POST/other methods form-encode
		// the same values into the body per the action's declared `type`.
		if method.uppercased() == "GET" {
			guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
				preconditionFailure("absoluteURL produced a URL that does not parse as components: \(url)")
			}
			components.queryItems = queryItems
			guard let queried = components.url else {
				preconditionFailure("query items did not produce a valid URL for: \(url)")
			}
			var request = URLRequest(url: queried)
			request.httpMethod = method
			return request
		}
		var request = URLRequest(url: url)
		request.httpMethod = method
		request.setValue(contentType, forHTTPHeaderField: "Content-Type")
		var components = URLComponents()
		components.queryItems = queryItems
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

	/// Decodes a body the client negotiated as Siren, verifying the response's
	/// media type first. A 200/201 carrying anything but the negotiated Siren type
	/// (a proxy HTML page, a future media type) is surfaced as
	/// `.unsupportedMediaType` rather than blind-decoded into a decode failure.
	private func decodeSiren<T: Decodable>(_ type: T.Type, data: Data, response: HTTPURLResponse) throws -> T {
		let contentType = response.value(forHTTPHeaderField: "Content-Type")
		guard isSirenMediaType(contentType) else { throw APIError.unsupportedMediaType(contentType) }
		guard let value = try? JSONDecoder().decode(type, from: data) else { throw APIError.decoding }
		return value
	}

	/// Whether a `Content-Type` header is the negotiated Siren media type, ignoring
	/// any `;charset=…` parameters and surrounding case.
	private func isSirenMediaType(_ header: String?) -> Bool {
		guard let header else { return false }
		let essence = header.split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
		return essence == AppConfig.sirenMediaType
	}

	private func decodeArticle(_ data: Data, response: HTTPURLResponse) throws -> Article {
		let entity = try decodeSiren(SirenEntity.self, data: data, response: response)
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
/// drop custom headers generally; the server bounces the client from the entry
/// point to the collection, so the followed redirect must keep them to stay
/// authenticated and keep negotiating Siren (the client header so onboarding
/// step 1 is recorded on the post-redirect `/queue` load).
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
