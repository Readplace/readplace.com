import AuthenticationServices
import XCTest
@testable import Readplace

/// The in-app auth core's three outcomes and the mapping that produces them from
/// `ASWebAuthenticationSession`'s completion. The distinction that matters: a user
/// dismissing the sheet must not reach the sign-in screen as an error, and neither
/// a dismissal nor a failed presentation may exchange a code.
@MainActor
final class WebAuthFlowTests: XCTestCase {
	private func makeRequest() -> AuthorizationRequest {
		OAuthService(
			baseURL: AppConfig.serverBaseURL,
			store: TestSupport.loggedInStore(),
			sessionConfiguration: TestSupport.stubbedConfiguration()
		).makeNativeLoginAuthorizationRequest()
	}

	func testTheReturnedCallbackIsExchangedWithTheSameRequestsPKCESecrets() async throws {
		let request = makeRequest()
		var exchangedURL: URL?
		var exchangedRequest: AuthorizationRequest?
		let flow = initWebAuthFlow(deps: WebAuthFlowDependencies(
			present: { _ in .success(.returned(callbackURL: URL(string: "\(AppConfig.nativeCallbackURL)?code=abc")!)) },
			exchange: { callbackURL, request in
				exchangedURL = callbackURL
				exchangedRequest = request
				return .success(())
			}
		))

		let result = await flow.start(request)

		guard case .success? = result else { return XCTFail("expected .success, got \(String(describing: result))") }
		XCTAssertEqual(try XCTUnwrap(exchangedURL).absoluteString, "\(AppConfig.nativeCallbackURL)?code=abc")
		let exchanged = try XCTUnwrap(exchangedRequest)
		XCTAssertEqual(
			exchanged.codeVerifier, request.codeVerifier,
			"the verifier that signed the authorize request must be the one exchanged — it lives in this call, not on disk"
		)
		XCTAssertEqual(exchanged.state, request.state)
		XCTAssertEqual(exchanged.redirectURI, AppConfig.nativeCallbackURL)
	}

	func testTheAuthorizeURLIsPresentedVerbatim() async throws {
		let request = makeRequest()
		var presented: URL?
		let flow = initWebAuthFlow(deps: WebAuthFlowDependencies(
			present: { url in
				presented = url
				return .success(.dismissed)
			},
			exchange: { _, _ in .success(()) }
		))

		_ = await flow.start(request)

		let url = try XCTUnwrap(presented)
		XCTAssertEqual(url, request.url)
		XCTAssertEqual(url.scheme, "https", "auth is presented in-app over https — never rewritten to a browser's custom scheme")
	}

	func testADismissedSheetReportsNothingAndExchangesNoCode() async {
		var exchangeCount = 0
		let flow = initWebAuthFlow(deps: WebAuthFlowDependencies(
			present: { _ in .success(.dismissed) },
			exchange: { _, _ in
				exchangeCount += 1
				return .success(())
			}
		))

		let result = await flow.start(makeRequest())

		XCTAssertNil(result, "dismissing the sheet is a choice, not an error the sign-in screen should show")
		XCTAssertEqual(exchangeCount, 0)
	}

	func testAFailedPresentationSurfacesTheErrorAndExchangesNoCode() async {
		var exchangeCount = 0
		let flow = initWebAuthFlow(deps: WebAuthFlowDependencies(
			present: { _ in .failure(AuthFlowError.presentationFailed) },
			exchange: { _, _ in
				exchangeCount += 1
				return .success(())
			}
		))

		guard case .failure(let error)? = await flow.start(makeRequest()) else {
			return XCTFail("expected .failure for a presentation that never ran")
		}
		XCTAssertEqual(
			(error as? AuthFlowError)?.errorDescription,
			AuthFlowError.presentationFailed.errorDescription
		)
		XCTAssertEqual(exchangeCount, 0)
	}

	func testAFailedExchangeIsReportedAsAFailure() async {
		let flow = initWebAuthFlow(deps: WebAuthFlowDependencies(
			present: { _ in .success(.returned(callbackURL: URL(string: AppConfig.nativeCallbackURL)!)) },
			exchange: { _, _ in .failure(AuthFlowError.missingCode) }
		))

		guard case .failure(let error)? = await flow.start(makeRequest()) else {
			return XCTFail("expected .failure for a rejected callback")
		}
		XCTAssertEqual((error as? AuthFlowError)?.errorDescription, AuthFlowError.missingCode.errorDescription)
	}

	func testACapturedCallbackURLIsTheReturnedOutcome() throws {
		let callback = URL(string: "\(AppConfig.nativeCallbackURL)?code=abc&state=S")!

		let outcome = try authPresentationOutcome(callbackURL: callback, error: nil).get()

		XCTAssertEqual(outcome, .returned(callbackURL: callback))
	}

	func testACancelledSheetMapsToDismissedRatherThanAnError() throws {
		let cancelled = NSError(
			domain: ASWebAuthenticationSessionErrorDomain,
			code: ASWebAuthenticationSessionError.canceledLogin.rawValue
		)

		let outcome = try authPresentationOutcome(callbackURL: nil, error: cancelled).get()

		XCTAssertEqual(outcome, .dismissed)
	}

	func testAnyOtherSessionErrorMapsToAFailure() {
		let presentationContextInvalid = NSError(
			domain: ASWebAuthenticationSessionErrorDomain,
			code: ASWebAuthenticationSessionError.presentationContextInvalid.rawValue
		)

		guard case .failure(let error) = authPresentationOutcome(callbackURL: nil, error: presentationContextInvalid) else {
			return XCTFail("a session error that is not a cancellation must surface as a failure")
		}
		XCTAssertEqual((error as NSError).code, ASWebAuthenticationSessionError.presentationContextInvalid.rawValue)
	}

	func testACompletionWithNeitherCallbackNorErrorIsAPresentationFailure() {
		guard case .failure(let error) = authPresentationOutcome(callbackURL: nil, error: nil) else {
			return XCTFail("a completion carrying nothing cannot be treated as a successful sign-in")
		}
		XCTAssertEqual(
			(error as? AuthFlowError)?.errorDescription,
			AuthFlowError.presentationFailed.errorDescription
		)
	}
}
