import Foundation

enum OAuthError: LocalizedError {
	case tokenExchangeFailed(status: Int)
	case refreshFailed
	case malformedResponse
	case noRefreshToken
	case sessionChanged

	var errorDescription: String? {
		switch self {
		case .tokenExchangeFailed(let status): return "Token exchange failed (HTTP \(status))."
		case .refreshFailed: return "Could not refresh the session. Please try again."
		case .malformedResponse: return "The server returned an unexpected token response."
		case .sessionChanged: return "The session changed. Please try again."
		case .noRefreshToken: return "No refresh token is stored. Please sign in again."
		}
	}
}

/// The parameters needed to launch the in-app authorization flow (shared by
/// Login and Sign up).
struct AuthorizationRequest {
	let url: URL
	let redirectURI: String
	let codeVerifier: String
	let state: String
}

/// Drives the OAuth 2.0 Authorization Code + PKCE flow against the server,
/// mirroring the browser extension's `initOAuthAuth`.
actor OAuthService {
	let baseURL: String
	let store: TokenStore
	private let nativeUserAgent: String
	private let session: URLSession
	private var generation = UUID()
	private var pending: (id: UUID, task: Task<RefreshResult, Error>)?

	struct Snapshot: Equatable {
		let tokens: OAuthTokens
		let generation: UUID
	}

	struct RefreshResult {
		let snapshot: Snapshot
		let recoveryProof: String?
	}

	func snapshot() throws -> Snapshot {
		guard let tokens = try store.loadTokens().get() else { throw OAuthError.noRefreshToken }
		return Snapshot(tokens: tokens, generation: generation)
	}

	func clear(ifUnchanged tokens: OAuthTokens?) {
		guard store.tokens == tokens else { return }
		clear()
	}

	func clear() {
		generation = UUID()
		pending = nil
		store.clear()
	}

	init(
		baseURL: String,
		store: TokenStore,
		nativeUserAgent: String,
		sessionConfiguration: URLSessionConfiguration = .default
	) {
		self.baseURL = baseURL
		self.store = store
		self.nativeUserAgent = nativeUserAgent
		self.session = URLSession(configuration: sessionConfiguration)
	}

	private var tokenEndpoint: URL { URL(string: "\(baseURL)/oauth/token")! }
	private var revokeEndpoint: URL { URL(string: "\(baseURL)/oauth/revoke")! }

	/// The custom-scheme redirect used by the auth flow (both Login and Sign up),
	/// which the in-app auth session captures to end the web flow.
	nonisolated var nativeRedirectURI: String { AppConfig.nativeCallbackURL }

	/// Builds the Login `/oauth/authorize` URL: the native custom-scheme callback
	/// plus `screen_hint=login`, so the server shows an unauthenticated user the
	/// sign-in screen (a session already authenticated in Safari's shared cookie
	/// jar passes straight through to consent, ignoring the hint).
	nonisolated func makeNativeLoginAuthorizationRequest() -> AuthorizationRequest {
		makeAuthorizationRequest(redirectURI: nativeRedirectURI, screenHint: "login")
	}

	/// Builds the Sign up `/oauth/authorize` URL: the native custom-scheme callback
	/// plus `screen_hint=signup`, so the server shows an unauthenticated user the
	/// sign-up screen (a session already authenticated in Safari's shared cookie
	/// jar passes straight through to consent, ignoring the hint).
	nonisolated func makeSignupAuthorizationRequest() -> AuthorizationRequest {
		makeAuthorizationRequest(redirectURI: nativeRedirectURI, screenHint: "signup")
	}

	nonisolated private func makeAuthorizationRequest(redirectURI: String, screenHint: String?) -> AuthorizationRequest {
		let verifier = PKCE.makeCodeVerifier()
		let challenge = PKCE.challenge(for: verifier)
		let state = PKCE.makeState()

		var components = URLComponents(string: "\(baseURL)/oauth/authorize")!
		var items = [
			URLQueryItem(name: "client_id", value: AppConfig.clientId),
			URLQueryItem(name: "redirect_uri", value: redirectURI),
			URLQueryItem(name: "response_type", value: "code"),
			URLQueryItem(name: "code_challenge", value: challenge),
			URLQueryItem(name: "code_challenge_method", value: "S256"),
			URLQueryItem(name: "state", value: state),
		]
		if let screenHint { items.append(URLQueryItem(name: "screen_hint", value: screenHint)) }
		components.queryItems = items
		return AuthorizationRequest(
			url: components.url!,
			redirectURI: redirectURI,
			codeVerifier: verifier,
			state: state
		)
	}

	/// Exchanges the authorization code for tokens and persists them. The OAuth
	/// server checks `redirect_uri` by exact string against the authorize request,
	/// so this must equal the `redirect_uri` that minted the code — the native
	/// custom scheme the auth flow redirects to.
	@discardableResult
	func exchangeCode(_ code: String, verifier: String, redirectURI: String) async throws -> OAuthTokens {
		generation = UUID()
		pending = nil
		let started = generation
		let body = formBody([
			"grant_type": "authorization_code",
			"code": code,
			"redirect_uri": redirectURI,
			"client_id": AppConfig.clientId,
			"code_verifier": verifier,
		])
		let (data, response) = try await session.data(for: tokenRequest(body))
		let status = (response as? HTTPURLResponse)?.statusCode ?? -1
		guard status == 200 else { throw OAuthError.tokenExchangeFailed(status: status) }
		let tokens = try parseTokens(data, fallbackRefresh: nil)
		guard generation == started else { throw OAuthError.sessionChanged }
		store.save(tokens)
		return tokens
	}

	@discardableResult
	func refresh() async throws -> String {
		try await refresh(after: snapshot()).snapshot.tokens.accessToken
	}

	func refresh(after failed: Snapshot) async throws -> RefreshResult {
		let current = try snapshot()
		guard current.generation == failed.generation else { throw OAuthError.sessionChanged }
		if current.tokens != failed.tokens {
			return RefreshResult(snapshot: current, recoveryProof: nil)
		}
		if let pending { return try await pending.task.value }
		let id = UUID()
		let task = Task { try await self.performRefresh(failed) }
		pending = (id, task)
		defer { if pending?.id == id { pending = nil } }
		return try await task.value
	}

	private func performRefresh(_ failed: Snapshot) async throws -> RefreshResult {
		let body = formBody([
			"grant_type": "refresh_token",
			"refresh_token": failed.tokens.refreshToken,
			"client_id": AppConfig.clientId,
		])
		let data: Data
		let response: URLResponse
		do { (data, response) = try await session.data(for: tokenRequest(body)) }
		catch {
			guard generation == failed.generation else { throw OAuthError.sessionChanged }
			let current = try snapshot()
			if current.tokens != failed.tokens { return RefreshResult(snapshot: current, recoveryProof: nil) }
			throw OAuthError.refreshFailed
		}
		guard generation == failed.generation else { throw OAuthError.sessionChanged }
		let http = response as? HTTPURLResponse
		let current = try snapshot()
		if current.tokens != failed.tokens {
			return RefreshResult(snapshot: current, recoveryProof: http?.value(forHTTPHeaderField: "X-Readplace-Refresh-Attempt"))
		}
		guard http?.statusCode == 200 else {
			struct Refusal: Decodable { let error: String }
			if http?.statusCode == 400,
				let refusal = try? JSONDecoder().decode(Refusal.self, from: data),
				refusal.error == "invalid_grant" {
				clear()
				throw OAuthError.noRefreshToken
			}
			throw OAuthError.refreshFailed
		}
		let tokens = try parseTokens(data, fallbackRefresh: failed.tokens.refreshToken)
		store.save(tokens)
		return RefreshResult(snapshot: try snapshot(), recoveryProof: nil)
	}

	func revoke() async {
		let refresh = store.tokens?.refreshToken
		clear()
		if let refresh {
			var request = URLRequest(url: revokeEndpoint)
			request.httpMethod = "POST"
			request.setValue("application/json", forHTTPHeaderField: "Content-Type")
			request.setValue(nativeUserAgent, forHTTPHeaderField: "User-Agent")
			request.httpBody = try? JSONSerialization.data(withJSONObject: ["token": refresh])
			_ = try? await session.data(for: request)
		}
	}

	// MARK: - Helpers

	private func tokenRequest(_ body: Data) -> URLRequest {
		var request = URLRequest(url: tokenEndpoint)
		request.httpMethod = "POST"
		request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
		request.setValue("application/json", forHTTPHeaderField: "Accept")
		request.setValue(nativeUserAgent, forHTTPHeaderField: "User-Agent")
		request.httpBody = body
		return request
	}

	private func parseTokens(_ data: Data, fallbackRefresh: String?) throws -> OAuthTokens {
		struct TokenResponse: Decodable {
			let access_token: String
			let refresh_token: String?
		}
		guard let parsed = try? JSONDecoder().decode(TokenResponse.self, from: data) else {
			throw OAuthError.malformedResponse
		}
		guard !parsed.access_token.isEmpty, let refresh = parsed.refresh_token ?? fallbackRefresh, !refresh.isEmpty else {
			throw OAuthError.malformedResponse
		}
		return OAuthTokens(accessToken: parsed.access_token, refreshToken: refresh)
	}

	private func formBody(_ params: [String: String]) -> Data {
		var components = URLComponents()
		components.queryItems = params.map { URLQueryItem(name: $0.key, value: $0.value) }
		// `httpBody` percent-encodes via the same rules as a form post.
		return Data((components.percentEncodedQuery ?? "").utf8)
	}
}
