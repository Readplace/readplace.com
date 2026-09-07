import Foundation
@testable import Readplace

@MainActor
final class FakeReadlistChooser: ReadlistChoosing {
	private let pick: ([Readlist]) -> Readlist
	private(set) var offered: [[Readlist]] = []

	nonisolated init(pick: @escaping ([Readlist]) -> Readlist) {
		self.pick = pick
	}

	func choose(among readlists: [Readlist]) async -> Readlist {
		offered.append(readlists)
		return pick(readlists)
	}
}
