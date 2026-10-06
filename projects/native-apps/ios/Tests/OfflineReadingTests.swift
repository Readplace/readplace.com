import WebKit
import XCTest
@testable import Readplace

final class OfflineReadingTests: XCTestCase {
	func testTheBannerSaysTheReadingIsOffline() {
		XCTAssertEqual(
			OfflineReading.bannerText,
			"Your internet is not working, your reading is offline. Readplace is read-only until you're back online."
		)
	}

	func testAConnectionThatNeverReachedTheServerIsATransportFailure() {
		let failures: [Error] = [
			URLError(.notConnectedToInternet),
			URLError(.timedOut),
			NSError(domain: NSURLErrorDomain, code: NSURLErrorCannotConnectToHost),
			NSError(domain: NSURLErrorDomain, code: NSURLErrorNetworkConnectionLost),
		]

		XCTAssertEqual(failures.map(OfflineReading.isTransportFailure), [true, true, true, true])
	}

	func testARequestThatTimedOutFallsBackLikeADroppedConnection() {
		let timeouts: [Error] = [
			URLError(.timedOut),
			NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut),
			OAuthError.refreshUnreachable(URLError(.timedOut)),
		]

		XCTAssertEqual(
			timeouts.map(OfflineReading.isTransportFailure), [true, true, true],
			"a list read, a reader page load and a session refresh that each gave up after ten silent seconds fall back to the stored copy"
		)
	}

	func testACancellationOrAServerAnswerIsNotATransportFailure() {
		let failures: [Error] = [
			URLError(.cancelled),
			NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled),
			APIError.unauthorized,
			APIError.server(status: 500, code: nil, message: nil),
			NSError(domain: "WebKitErrorDomain", code: 102),
		]

		XCTAssertEqual(failures.map(OfflineReading.isTransportFailure), [false, false, false, false, false])
	}

	func testASessionRefreshThatNeverReachedTheServerIsATransportFailure() {
		let failures: [Error] = [
			OAuthError.refreshUnreachable(URLError(.notConnectedToInternet)),
			OAuthError.refreshUnreachable(URLError(.cancelled)),
			OAuthError.refreshFailed,
		]

		XCTAssertEqual(failures.map(OfflineReading.isTransportFailure), [true, false, false])
	}

	func testAnOfflineLoadTakesTheStoredCopyWithoutAskingTheServer() {
		XCTAssertEqual(OfflineReading.cachePolicy(offline: true), .returnCacheDataElseLoad)
	}

	func testAnOnlineLoadKeepsTheServersCachingRules() {
		XCTAssertEqual(OfflineReading.cachePolicy(offline: false), .useProtocolCachePolicy)
	}

	func testAnOfflineLoadTurnsLazyImagesEagerOnceTheDocumentIsParsed() throws {
		let scripts = OfflineReading.userScripts(for: .returnCacheDataElseLoad)

		let script = try XCTUnwrap(scripts.first)
		XCTAssertEqual(scripts.count, 1)
		XCTAssertEqual(
			script.source,
			"document.querySelectorAll('img[loading=\"lazy\"]').forEach(function (image) { image.loading = 'eager'; });"
		)
		XCTAssertEqual(script.injectionTime, .atDocumentEnd)
		XCTAssertEqual(script.isForMainFrameOnly, true)
	}

	func testAnOnlineLoadLeavesLazyImagesLazy() {
		XCTAssertEqual(OfflineReading.userScripts(for: .useProtocolCachePolicy).map(\.source), [])
	}

	func testTheDownloadControlTakesTheTintOfTheToolbarControlsBesideIt() {
		XCTAssertEqual(OfflineReading.downloadControlTint, AffordancePresentation(token: "account").tint)
		XCTAssertEqual(OfflineReading.downloadControlTint, AffordancePresentation(token: "add-links-help").tint)
	}
}
