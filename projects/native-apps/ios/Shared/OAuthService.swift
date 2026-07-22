import Foundation

enum OAuthError: LocalizedError {
	case tokenExchangeFailed(status: Int)
	case refreshFailed
	case malformedResponse
	case noRefreshToken

	var errorDescription: String? {
		switch self {
		case .tokenExchangeFailed(let status): return "Token exchange failed (HTTP \(status))."
		case .refreshFailed: return "Could not refresh the session. Please sign in again."
		case .malformedResponse: return "The server returned an unexpected token response."
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
struct OAuthService {
	let baseURL: String
	let store: TokenStore
	private let session: URLSession

	init(baseURL: String, store: TokenStore, sessionConfiguration: URLSessionConfiguration = .default) {
		self.baseURL = baseURL
		self.store = store
		self.session = URLSession(configuration: sessionConfiguration)
	}

	private var tokenEndpoint: URL { URL(string: "\(baseURL)/oauth/token")! }
	private var revokeEndpoint: URL { URL(string: "\(baseURL)/oauth/revoke")! }

	/// The custom-scheme redirect used by the auth flow (both Login and Sign up),
	/// which the in-app auth session captures to end the web flow.
	var nativeRedirectURI: String { AppConfig.nativeCallbackURL }

	/// Builds the Login `/oauth/authorize` URL: the native custom-scheme callback
	/// plus `screen_hint=login`, so the server shows an unauthenticated user the
	/// sign-in screen (a session already authenticated in Safari's shared cookie
	/// jar passes straight through to consent, ignoring the hint).
	func makeNativeLoginAuthorizationRequest() -> AuthorizationRequest {
		makeAuthorizationRequest(redirectURI: nativeRedirectURI, screenHint: "login")
	}

	/// Builds the Sign up `/oauth/authorize` URL: the native custom-scheme callback
	/// plus `screen_hint=signup`, so the server shows an unauthenticated user the
	/// sign-up screen (a session already authenticated in Safari's shared cookie
	/// jar passes straight through to consent, ignoring the hint).
	func makeSignupAuthorizationRequest() -> AuthorizationRequest {
		makeAuthorizationRequest(redirectURI: nativeRedirectURI, screenHint: "signup")
	}

	private func makeAuthorizationRequest(redirectURI: String, screenHint: String?) -> AuthorizationRequest {
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
		store.save(tokens)
		return tokens
	}

	/// Uses the stored refresh token to mint a new access token. Persists the
	/// result and returns the new access token, or throws on failure.
	@discardableResult
	func refresh() async throws -> String {
		guard let refresh = store.tokens?.refreshToken else { throw OAuthError.noRefreshToken }
		let body = formBody([
			"grant_type": "refresh_token",
			"refresh_token": refresh,
			"client_id": AppConfig.clientId,
		])
		let (data, response) = try await session.data(for: tokenRequest(body))
		guard (response as? HTTPURLResponse)?.statusCode == 200 else {
			throw OAuthError.refreshFailed
		}
		let tokens = try parseTokens(data, fallbackRefresh: refresh)
		store.updateAccessToken(tokens.accessToken, refreshToken: tokens.refreshToken)
		return tokens.accessToken
	}

	/// Best-effort token revocation (logout), then clears local tokens.
	func revoke() async {
		if let refresh = store.tokens?.refreshToken {
			var request = URLRequest(url: revokeEndpoint)
			request.httpMethod = "POST"
			request.setValue("application/json", forHTTPHeaderField: "Content-Type")
			request.httpBody = try? JSONSerialization.data(withJSONObject: ["token": refresh])
			_ = try? await session.data(for: request)
		}
		store.clear()
	}

	// MARK: - Helpers

	private func tokenRequest(_ body: Data) -> URLRequest {
		var request = URLRequest(url: tokenEndpoint)
		request.httpMethod = "POST"
		request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
		request.setValue("application/json", forHTTPHeaderField: "Accept")
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
		guard let refresh = parsed.refresh_token ?? fallbackRefresh else {
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
