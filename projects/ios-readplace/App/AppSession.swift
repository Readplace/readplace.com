import Foundation
import WebKit

/// Why an authorization callback was rejected before any token exchange.
enum AuthFlowError: LocalizedError {
	case denied(String)
	case missingCode
	case stateMismatch

	var errorDescription: String? {
		switch self {
		case .denied(let reason): return "Authorization was denied (\(reason))."
		case .missingCode: return "No authorization code was returned."
		case .stateMismatch: return "Security check failed (state mismatch)."
		}
	}
}

/// App-wide auth/session state, plus factories so views reach the API and OAuth
/// with current config rather than constructing them with stale values.
@MainActor
final class AppSession: ObservableObject {
	@Published private(set) var isLoggedIn: Bool

	private let store: TokenStore
	private let sessionConfiguration: URLSessionConfiguration
	private let wipeReaderWebStore: () async -> Void

	// Defaults to an ephemeral configuration so the API/OAuth sessions keep their
	// cookie jar in an isolated, in-memory store rather than process-wide
	// `HTTPCookieStorage.shared` — the minted `hutch_sid` reader cookie must not
	// linger in the shared jar where it would outlive a sign-out.
	//
	// `wipeReaderWebStore` defaults to the real WebKit deletion; it's the
	// OS-boundary seam tests replace with a spy.
	init(
		store: TokenStore = TokenStore(),
		sessionConfiguration: URLSessionConfiguration = .ephemeral,
		wipeReaderWebStore: @escaping () async -> Void = AppSession.removeReaderWebStoreData
	) {
		self.store = store
		self.sessionConfiguration = sessionConfiguration
		self.wipeReaderWebStore = wipeReaderWebStore
		self.isLoggedIn = store.isLoggedIn
	}

	func refreshLoginState() {
		isLoggedIn = store.isLoggedIn
	}

	/// Completes sign-in: validate the callback, exchange the code for tokens, flip
	/// the session to logged-in.
	///
	/// `redirectURI` must equal the one the authorize request used — the OAuth
	/// server checks it by exact string at token time.
	func completeSignIn(
		callbackURL: URL,
		verifier: String,
		expectedState: String,
		redirectURI: String
	) async -> Result<Void, Error> {
		let items = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems ?? []
		func value(_ name: String) -> String? { items.first { $0.name == name }?.value }

		if let error = value("error") { return .failure(AuthFlowError.denied(error)) }
		guard let code = value("code") else { return .failure(AuthFlowError.missingCode) }
		guard value("state") == expectedState else { return .failure(AuthFlowError.stateMismatch) }

		do {
			try await makeOAuth().exchangeCode(code, verifier: verifier, redirectURI: redirectURI)
			refreshLoginState()
			return .success(())
		} catch {
			return .failure(error)
		}
	}

	func logout() async {
		// The WebKit wipe and the network revoke are independent, so they run
		// concurrently; both finish before the logged-out state is published.
		let readerWipe = Task { await self.wipeReaderWebStore() }
		await makeOAuth().revoke()
		clearSessionCookie()
		await readerWipe.value
		isLoggedIn = false
	}

	/// Local sign-out used when the session is already invalid (refresh failed).
	/// Stays synchronous so the non-async `onSessionExpired` caller is unaffected;
	/// the returned wipe task lets tests await the fire-and-forget WebKit wipe.
	@discardableResult
	func forceLogout() -> Task<Void, Never> {
		store.clear()
		clearSessionCookie()
		let readerWipe = Task { await self.wipeReaderWebStore() }
		isLoggedIn = false
		return readerWipe
	}

	private static func isSessionCookie(_ cookie: HTTPCookie) -> Bool {
		cookie.name == AppConfig.sessionCookieName
	}

	/// Drops the minted browser session cookie (`hutch_sid`) on sign-out so it
	/// doesn't linger in the API session's cookie jar for the next sign-in in the
	/// same process. The jar is the configuration's own isolated store (never
	/// `HTTPCookieStorage.shared`), so this clears only this app's copy.
	private func clearSessionCookie() {
		let storage = sessionConfiguration.httpCookieStorage
		for cookie in storage?.cookies ?? [] where Self.isSessionCookie(cookie) {
			storage?.deleteCookie(cookie)
		}
	}

	/// Removes the reader's authenticated traces from the process-wide WebKit
	/// default store on sign-out. The session cookie is deleted by name — a
	/// blanket cookie wipe would also drop server-set reader state (the dismissed
	/// changelog banner would reappear) — while every non-cookie data type
	/// (cache, local/session storage, IndexedDB) is cleared so the reading
	/// history of the signed-out account doesn't stay on disk.
	private static func removeReaderWebStoreData() async {
		let store = WKWebsiteDataStore.default()
		for cookie in await store.httpCookieStore.allCookies() where isSessionCookie(cookie) {
			await store.httpCookieStore.delete(cookie)
		}
		let nonCookieTypes = WKWebsiteDataStore.allWebsiteDataTypes().subtracting([WKWebsiteDataTypeCookies])
		await store.removeData(ofTypes: nonCookieTypes, modifiedSince: .distantPast)
	}

	func makeAPI() -> ReadplaceAPI {
		ReadplaceAPI(baseURL: AppConfig.serverBaseURL, store: store, sessionConfiguration: sessionConfiguration)
	}

	func makeOAuth() -> OAuthService {
		OAuthService(baseURL: AppConfig.serverBaseURL, store: store, sessionConfiguration: sessionConfiguration)
	}
}
