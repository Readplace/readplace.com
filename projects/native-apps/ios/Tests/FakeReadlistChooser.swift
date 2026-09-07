import Foundation
@testable import Readplace

@MainActor
final class FakeReadlistChooser: ReadlistChoosing {
	private let pick: ([Readlist]) -> Set<Readlist>
	private(set) var offered: [[Readlist]] = []

	nonisolated init(pick: @escaping ([Readlist]) -> Set<Readlist>) {
		self.pick = pick
	}

	func choose(among readlists: [Readlist]) async -> Set<Readlist> {
		offered.append(readlists)
		return pick(readlists)
	}
}
