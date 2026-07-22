import SwiftUI
import UIKit
import XCTest
@testable import Readplace

/// The login screen's only decisions: which authorize request each button
/// starts (transposing them would send Sign up to the login screen) and that a
/// fresh attempt clears the previous attempt's error.
@MainActor
final class LoginViewTests: XCTestCase {
	@MainActor
	private final class Captured {
		var requests: [AuthorizationRequest] = []
		var errorText: String? = "Authorization was denied (access_denied)."
		/// What the injected flow answers for every attempt: `nil` models the user
		/// dismissing the auth sheet, a `.failure` models a rejected callback.
		var outcome: Result<Void, Error>?
		let mutePreference: IntroMutePreference
		let intro: LaunchIntroModel

		init() {
			let defaults = TestSupport.ephemeralDefaults()
			mutePreference = IntroMutePreference(defaults: defaults)
			intro = LaunchIntroModel(
				seen: LaunchIntroSeen(defaults: defaults),
				music: IntroMusic(start: {}, stop: {}, restart: {}, seek: { _ in }, setMuted: { _ in }),
				mutePreference: mutePreference,
				reduceMotion: true
			)
		}
	}

	private func makeView(_ captured: Captured) -> LoginView {
		LoginView(
			session: AppSession(
				store: TokenStore(defaults: TestSupport.ephemeralDefaults()),
				sessionConfiguration: TestSupport.stubbedConfiguration()
			),
			authErrorText: Binding(get: { captured.errorText }, set: { captured.errorText = $0 }),
			makeFlow: { _ in
				WebAuthFlow(start: { request in
					captured.requests.append(request)
					return captured.outcome
				})
			},
			intro: captured.intro
		)
	}

	private func queryItems(_ request: AuthorizationRequest) -> [String: String] {
		let items = URLComponents(url: request.url, resolvingAgainstBaseURL: false)?.queryItems ?? []
		return Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
	}

	func testLoginButtonClearsTheStaleErrorAndStartsALoginAuthorization() async throws {
		let captured = Captured()

		await makeView(captured).startLogin()

		XCTAssertNil(captured.errorText, "a fresh attempt must clear the previous attempt's error")
		XCTAssertEqual(captured.requests.count, 1)
		let request = try XCTUnwrap(captured.requests.first)
		XCTAssertEqual(queryItems(request)["screen_hint"], "login")
		XCTAssertEqual(request.redirectURI, AppConfig.nativeCallbackURL)
	}

	func testSignupButtonClearsTheStaleErrorAndStartsASignupAuthorization() async throws {
		let captured = Captured()

		await makeView(captured).startSignup()

		XCTAssertNil(captured.errorText, "a fresh attempt must clear the previous attempt's error")
		XCTAssertEqual(captured.requests.count, 1)
		let request = try XCTUnwrap(captured.requests.first)
		XCTAssertEqual(queryItems(request)["screen_hint"], "signup")
		XCTAssertEqual(request.redirectURI, AppConfig.nativeCallbackURL)
	}

	func testAFailedAttemptSurfacesItsMessageOnTheSignInScreen() async {
		let captured = Captured()
		captured.outcome = .failure(AuthFlowError.stateMismatch)

		await makeView(captured).startLogin()

		XCTAssertEqual(captured.errorText, AuthFlowError.stateMismatch.errorDescription)
	}

	func testDismissingTheAuthSheetLeavesTheSignInScreenWithoutAnError() async {
		let captured = Captured()
		captured.outcome = nil

		await makeView(captured).startLogin()

		XCTAssertNil(captured.errorText, "a dismissal is a choice, not a failure to report")
	}

	func testASuccessfulAttemptReportsNoError() async {
		let captured = Captured()
		captured.outcome = .success(())

		await makeView(captured).startSignup()

		XCTAssertNil(captured.errorText)
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

	func testTappingTheLogoCircleReplaysTheIntro() {
		let captured = Captured()
		XCTAssertEqual(captured.intro.phase, .idle)

		makeView(captured).replayIntro()

		XCTAssertEqual(captured.intro.phase, .playing, "tapping the logo circle re-enters the intro")
	}

	func testTheMuteButtonTogglesAndRemembersThePreference() {
		let captured = Captured()
		XCTAssertFalse(captured.intro.isMuted)

		makeView(captured).toggleMute()

		XCTAssertTrue(captured.intro.isMuted)
		XCTAssertTrue(captured.mutePreference.isMuted, "the mute preference is remembered across launches")

		makeView(captured).toggleMute()

		XCTAssertFalse(captured.intro.isMuted)
	}

	func testTheReplayHitTargetSitsOnTheAmberDot() {
		XCTAssertEqual(BrandMarkGeometry.dot.x, 353.0 / 512 * 72, accuracy: 0.01)
		XCTAssertEqual(BrandMarkGeometry.dot.y, 182.0 / 512 * 72, accuracy: 0.01)
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
