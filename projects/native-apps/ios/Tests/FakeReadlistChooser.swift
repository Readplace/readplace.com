import Foundation
@testable import Readplace

@MainActor
final class FakeReadlistChooser: ReadlistChoosing {
	private let pick: ([Readlist]) -> Set<Readlist>
	private(set) var offered: [[SharedArticlesDrop]] = []

	nonisolated init(pick: @escaping ([Readlist]) -> Set<Readlist>) {
		self.pick = pick
	}

	func choose(among drops: [SharedArticlesDrop]) async -> Set<Readlist> {
		offered.append(drops)
		return pick(drops.compactMap(\.choice))
	}
}
