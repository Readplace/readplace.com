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
}
