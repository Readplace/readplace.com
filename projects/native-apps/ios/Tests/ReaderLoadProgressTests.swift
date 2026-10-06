import XCTest
@testable import Readplace

final class ReaderLoadProgressTests: XCTestCase {
	// MARK: rendering(estimatedProgress:)

	func testRenderingWrapsEstimatedProgress() {
		XCTAssertEqual(ReaderLoad.rendering(estimatedProgress: 0.7), .rendering(progress: 0.7))
	}

	func testRenderingClampsProgressBelowZero() {
		XCTAssertEqual(ReaderLoad.rendering(estimatedProgress: -0.5), .rendering(progress: 0))
	}

	func testRenderingClampsProgressAboveOne() {
		XCTAssertEqual(ReaderLoad.rendering(estimatedProgress: 1.5), .rendering(progress: 1))
	}

	// MARK: overlay(for:)

	func testLoadingOverlayShowsSkeletonAndTheHeadStartBar() {
		XCTAssertEqual(
			ReaderLoad.overlay(for: .loading),
			ReaderLoadOverlay(showsSkeleton: true, showsProgressBar: true, progress: 0.1)
		)
	}

	func testRenderingOverlayShowsBarWithoutSkeleton() {
		XCTAssertEqual(
			ReaderLoad.overlay(for: .rendering(progress: 0.7)),
			ReaderLoadOverlay(showsSkeleton: false, showsProgressBar: true, progress: 0.7)
		)
	}

	func testRenderingOverlayNeverRegressesBelowTheHeadStart() {
		XCTAssertEqual(ReaderLoad.overlay(for: .rendering(progress: 0.02)).progress, 0.1)
	}

	func testFinishedOverlayHidesEverythingAtFull() {
		XCTAssertEqual(
			ReaderLoad.overlay(for: .finished),
			ReaderLoadOverlay(showsSkeleton: false, showsProgressBar: false, progress: 1)
		)
	}

	func testFailedOverlayHidesEverythingAtFull() {
		XCTAssertEqual(
			ReaderLoad.overlay(for: .failed),
			ReaderLoadOverlay(showsSkeleton: false, showsProgressBar: false, progress: 1)
		)
	}

	// MARK: isRealFailure(error:)

	func testCancelledNavigationIsNotARealFailure() {
		let error = NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled, userInfo: nil)
		XCTAssertFalse(ReaderLoad.isRealFailure(error: error))
	}

	func testPolicyChangeInterruptionIsNotARealFailure() {
		let error = NSError(domain: "WebKitErrorDomain", code: 102, userInfo: nil)
		XCTAssertFalse(ReaderLoad.isRealFailure(error: error))
	}

	func testTransportErrorIsARealFailure() {
		let error = NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut, userInfo: nil)
		XCTAssertTrue(ReaderLoad.isRealFailure(error: error))
	}

	func testNonCancelURLErrorIsARealFailure() {
		let error = NSError(domain: NSURLErrorDomain, code: NSURLErrorCannotConnectToHost, userInfo: nil)
		XCTAssertTrue(ReaderLoad.isRealFailure(error: error))
	}

	func testWebKitErrorOtherThanPolicyChangeIsARealFailure() {
		let error = NSError(domain: "WebKitErrorDomain", code: 101, userInfo: nil)
		XCTAssertTrue(ReaderLoad.isRealFailure(error: error))
	}

	func testAServerLoadThatCouldNotConnectReloadsTheStoredCopyInTheSameWebView() {
		let error = NSError(domain: NSURLErrorDomain, code: NSURLErrorCannotConnectToHost)

		XCTAssertEqual(
			ReaderLoad.recovery(error: error, stage: .provisional, policy: .useProtocolCachePolicy),
			.reloadFromCacheInPlace
		)
	}

	func testAServerLoadThatTimedOutBeforeThePageCommittedReloadsTheStoredCopyInTheSameWebView() {
		let error = NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut)

		XCTAssertEqual(
			ReaderLoad.recovery(error: error, stage: .provisional, policy: .useProtocolCachePolicy),
			.reloadFromCacheInPlace,
			"a page load that stalled for ten silent seconds falls back like a dropped connection"
		)
	}

	func testAConnectionLostAfterThePageCommittedReopensTheStoredCopyInANewWebView() {
		let failures = [
			NSError(domain: NSURLErrorDomain, code: NSURLErrorNetworkConnectionLost),
			NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut),
		]

		XCTAssertEqual(
			failures.map { ReaderLoad.recovery(error: $0, stage: .committed, policy: .useProtocolCachePolicy) },
			[.reopenFromCache, .reopenFromCache],
			"a web view that already shows the URL sends a cache-first load of it to the network, so only a new one can show the stored copy"
		)
	}

	func testALoadOfTheStoredCopyThatFailsDoesNotRetry() {
		let notConnected = NSError(domain: NSURLErrorDomain, code: NSURLErrorCannotConnectToHost)
		let connectionLost = NSError(domain: NSURLErrorDomain, code: NSURLErrorNetworkConnectionLost)

		XCTAssertEqual(
			[
				ReaderLoad.recovery(error: notConnected, stage: .provisional, policy: .returnCacheDataElseLoad),
				ReaderLoad.recovery(error: connectionLost, stage: .committed, policy: .returnCacheDataElseLoad),
			],
			[.fail, .fail]
		)
	}

	func testAFailureThatIsNotTheConnectionDoesNotRetry() {
		let error = NSError(domain: "WebKitErrorDomain", code: 101)

		XCTAssertEqual(
			[ReaderLoadStage.provisional, .committed].map {
				ReaderLoad.recovery(error: error, stage: $0, policy: .useProtocolCachePolicy)
			},
			[.fail, .fail]
		)
	}

	private let now = Date(timeIntervalSince1970: 1_791_158_400)

	func testAStoredCopyTheServerDatedWithinThirtyDaysIsShown() {
		XCTAssertEqual(
			ReaderLoad.showsResponse(
				dated: "Sun, 04 Oct 2026 00:00:00 GMT", policy: .returnCacheDataElseLoad, isForMainFrame: true, now: now
			),
			true
		)
	}

	func testAStoredCopyOlderThanThirtyDaysIsNotShown() {
		XCTAssertEqual(
			ReaderLoad.showsResponse(
				dated: "Fri, 04 Sep 2026 23:59:59 GMT", policy: .returnCacheDataElseLoad, isForMainFrame: true, now: now
			),
			false,
			"a reader copy kept more than thirty days ago gives way to the unavailable view, so no stored page outlives its use"
		)
	}

	func testAStoredCopyWithNoDateIsNotShown() {
		XCTAssertEqual(
			ReaderLoad.showsResponse(dated: nil, policy: .returnCacheDataElseLoad, isForMainFrame: true, now: now),
			false
		)
	}

	func testAPageFromTheServerIsShownWhateverItsDate() {
		XCTAssertEqual(
			ReaderLoad.showsResponse(
				dated: "Fri, 04 Sep 2026 23:59:59 GMT", policy: .useProtocolCachePolicy, isForMainFrame: true, now: now
			),
			true,
			"an online load is the server's answer now, not a copy"
		)
	}

	func testAFrameInsideAStoredCopyIsLeftToThePage() {
		XCTAssertEqual(
			ReaderLoad.showsResponse(dated: nil, policy: .returnCacheDataElseLoad, isForMainFrame: false, now: now),
			true,
			"only the article page itself is judged by its age"
		)
	}
}
