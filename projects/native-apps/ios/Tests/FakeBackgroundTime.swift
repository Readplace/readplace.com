import UIKit
@testable import Readplace

@MainActor
final class FakeBackgroundTime: BackgroundTimeKeeping {
	private(set) var events: [String] = []

	func begin() {
		events.append("begin")
	}

	func end() {
		events.append("end")
	}
}
