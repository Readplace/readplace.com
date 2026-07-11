import SwiftUI
import UIKit
import XCTest
@testable import Readplace

/// The login screen's only decisions: which authorize request each button
/// starts (transposing them would send Sign up to the login screen) and that a
/// fresh attempt clears the previous attempt's error.
@MainActor
final class LoginViewTests: XCTestCase {
	private final class Captured {
		var requests: [AuthorizationRequest] = []
		var errorText: String? = "Authorization was denied (access_denied)."
	}

	private func makeView(_ captured: Captured) -> LoginView {
		LoginView(
			session: AppSession(
				store: TokenStore(defaults: TestSupport.ephemeralDefaults()),
				sessionConfiguration: TestSupport.stubbedConfiguration()
			),
			authErrorText: Binding(get: { captured.errorText }, set: { captured.errorText = $0 }),
			makeFlow: { _ in WebAuthFlow(start: { captured.requests.append($0) }, complete: { _ in nil }) }
		)
	}

	private func queryItems(_ request: AuthorizationRequest) -> [String: String] {
		let items = URLComponents(url: request.url, resolvingAgainstBaseURL: false)?.queryItems ?? []
		return Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
	}

	func testLoginButtonClearsTheStaleErrorAndStartsALoginAuthorization() throws {
		let captured = Captured()

		makeView(captured).startLogin()

		XCTAssertNil(captured.errorText, "a fresh attempt must clear the previous attempt's error")
		XCTAssertEqual(captured.requests.count, 1)
		let request = try XCTUnwrap(captured.requests.first)
		XCTAssertEqual(queryItems(request)["screen_hint"], "login")
		XCTAssertEqual(request.redirectURI, AppConfig.nativeCallbackURL)
	}

	func testSignupButtonClearsTheStaleErrorAndStartsASignupAuthorization() throws {
		let captured = Captured()

		makeView(captured).startSignup()

		XCTAssertNil(captured.errorText, "a fresh attempt must clear the previous attempt's error")
		XCTAssertEqual(captured.requests.count, 1)
		let request = try XCTUnwrap(captured.requests.first)
		XCTAssertEqual(queryItems(request)["screen_hint"], "signup")
		XCTAssertEqual(request.redirectURI, AppConfig.nativeCallbackURL)
	}

	func testTheLoginScreenRendersWithAndWithoutAnAuthError() {
		// Rendered in a real window so body coverage — including the error
		// branch — is deterministic instead of depending on the app host
		// happening to launch logged out. SwiftUI draws text into shared
		// backing views, so the error's own pixels are not observable from
		// UIKit here; mounting a live hierarchy in both states is.
		let erroring = Captured()
		let clean = Captured()
		clean.errorText = nil

		XCTAssertGreaterThan(renderedViewCount(makeView(erroring)), 1, "the erroring login screen must mount a live view hierarchy")
		XCTAssertGreaterThan(renderedViewCount(makeView(clean)), 1, "the clean login screen must mount a live view hierarchy")
	}

	private func renderedViewCount(_ view: LoginView) -> Int {
		let window = UIWindow(frame: UIScreen.main.bounds)
		window.rootViewController = UIHostingController(rootView: view)
		window.makeKeyAndVisible()
		window.layoutIfNeeded()
		return viewCount(in: window)
	}

	private func viewCount(in view: UIView) -> Int {
		view.subviews.reduce(1) { $0 + viewCount(in: $1) }
	}
}
