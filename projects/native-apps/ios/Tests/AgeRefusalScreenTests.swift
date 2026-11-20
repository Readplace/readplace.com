import SwiftUI
import UIKit
import XCTest

@testable import Readplace

@MainActor
final class AgeRefusalScreenTests: XCTestCase {
	private static let size = CGSize(width: 390, height: 844)

	private static let checkpoints: [(name: String, style: UIUserInterfaceStyle)] = [
		("under-13", .light),
		("under-13", .dark),
		("approval-missing", .light),
	]

	func testTheRefusalSitsCentredInsideTheMargins() {
		let screen = AgeRefusalScreen(text: AgeRefusal.under13.fallbackText)
		let root = mount(screen.controller)

		let frame = screen.messageView.frame
		let margins = root.layoutMarginsGuide.layoutFrame
		XCTAssertGreaterThan(frame.height, 0, "the message lays out with a height")
		XCTAssertGreaterThanOrEqual(frame.minX, margins.minX + 16, "the message keeps clear of the leading margin")
		XCTAssertLessThanOrEqual(frame.maxX, margins.maxX - 16, "and of the trailing margin")
		XCTAssertEqual(frame.midX, margins.midX, accuracy: 0.5, "the message is centred across the screen")
		XCTAssertEqual(frame.midY, margins.midY, accuracy: 0.5, "and down it")
		assertLayoutIsStable(root, [screen.messageView])
	}

	func testTheUnder13RefusalLooksRight() {
		let root = mount(AgeRefusalScreen(text: AgeRefusal.under13.fallbackText).controller)

		assertHostIsNeutral()
		assertMatchesBaseline(root, checkpoint: "under-13", style: .light)
	}

	func testTheUnder13RefusalLooksRightInDarkMode() {
		let root = mount(AgeRefusalScreen(text: AgeRefusal.under13.fallbackText).controller)

		assertHostIsNeutral()
		assertMatchesBaseline(root, checkpoint: "under-13", style: .dark)
	}

	func testTheServersWordsReplaceTheLocalText() {
		let screen = AgeRefusalScreen(text: AgeRefusal.under13.fallbackText)
		let root = mount(screen.controller)

		screen.show(text: AgeRefusal.parentalApprovalMissing.fallbackText)

		assertHostIsNeutral()
		assertMatchesBaseline(root, checkpoint: "approval-missing", style: .light)
	}

	func testTheSwiftUIBridgeHostsTheScreenAndFollowsNewText() {
		let host = UIHostingController(rootView: AgeRefusalView(text: AgeRefusal.under13.fallbackText))
		let root = mount(host)
		let firstSubviews = root.subviews.count

		host.rootView = AgeRefusalView(text: AgeRefusal.parentalApprovalMissing.fallbackText)
		CardCheckpoint.settle(root)

		XCTAssertGreaterThan(firstSubviews, 0, "the bridge mounts the UIKit screen")
		XCTAssertEqual(root.subviews.count, firstSubviews, "new text updates the screen in place rather than rebuilding it")
	}

	func testEveryCheckpointHasABaselineForEveryRuntimeAlreadyCovered() {
		let directory = CardCheckpoint.baselineDirectory(for: #filePath)
		let committed = Set(CardCheckpoint.committedNames(in: directory))
		let runtimes = CardCheckpoint.coveredRuntimes(in: directory)

		XCTAssertFalse(
			runtimes.isEmpty,
			"the snapshot directory holds no baselines at all; mint them with make test RECORD_SNAPSHOTS=1"
		)
		for runtime in runtimes {
			for checkpoint in Self.checkpoints {
				let name = CardCheckpoint.baselineName(checkpoint.name, checkpoint.style, runtime: runtime)
				XCTAssertTrue(
					committed.contains(name),
					"\(name) is missing while \(runtime) has other baselines; a runtime refreshed alone leaves the rest stale"
				)
			}
		}
	}

	// MARK: - Helpers

	private func mount(_ controller: UIViewController) -> UIView {
		let window = UIWindow(frame: CGRect(origin: .zero, size: Self.size))
		window.rootViewController = controller
		window.makeKeyAndVisible()
		window.layoutIfNeeded()
		mounted.append(window)
		CardCheckpoint.settle(controller.view)
		return controller.view
	}

	private var mounted: [UIWindow] = []
}
