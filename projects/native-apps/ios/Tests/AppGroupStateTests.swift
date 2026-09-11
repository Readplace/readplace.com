import Foundation
import XCTest

final class AppGroupStateTests: XCTestCase {
	private static let compiledOnlyIntoTheApp = ["App", "Tests", "UITests", "build"]
	private static let neverShipped = ["Tests", "UITests", "build"]
	private static let opensAnAppGroupSuite = #"\(\s*suiteName\s*:|addSuite\s*\(\s*named\s*:"#

	private static let mayOpenTheEarlierBuildsDefaults = [
		"Shared/ShareTarget.swift": 1,
		"Shared/TokenStore.swift": 1,
	]

	private static let mayResolveTheSharedContainer = [
		"App/ShareArtifacts.swift",
		"Shared/AppGroupStore.swift",
		"Shared/UnseenSave.swift",
		"Shared/UploadJobStore.swift",
		"Shared/UploadStaging.swift",
	]

	private func sources(excluding excluded: [String]) throws -> [(path: String, text: String)] {
		let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
		let walker = try XCTUnwrap(
			FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]),
			"the iOS sources must be walkable from the test bundle's own source location"
		)
		var found: [(path: String, text: String)] = []
		for case let url as URL in walker {
			let relative = Array(url.pathComponents.dropFirst(root.pathComponents.count))
			if let top = relative.first, excluded.contains(top) {
				walker.skipDescendants()
				continue
			}
			guard url.pathExtension == "swift" else { continue }
			found.append((relative.joined(separator: "/"), try String(contentsOf: url)))
		}
		XCTAssertGreaterThan(
			found.count, 20,
			"a scan that resolves to no sources is a rule that passes by measuring nothing"
		)
		return found
	}

	private func openings(in text: String) throws -> Int {
		try NSRegularExpression(pattern: Self.opensAnAppGroupSuite)
			.numberOfMatches(in: text, range: NSRange(text.startIndex..., in: text))
	}

	func testNoCodeTheShareExtensionCanRunKeepsStateInAnAppGroupDefaultsSuite() throws {
		let offenders = try sources(excluding: Self.compiledOnlyIntoTheApp)
			.filter { try openings(in: $0.text) > 0 }
			.map(\.path)
			.filter { Self.mayOpenTheEarlierBuildsDefaults[$0] == nil }

		XCTAssertEqual(
			offenders, [],
			"""
			\(offenders.joined(separator: ", ")) keeps state the share extension can read in an App Group \
			UserDefaults suite. A process that stays alive keeps serving its own snapshot of that suite and \
			never sees the other one's writes. Store it as an AppGroupValue instead.
			"""
		)
	}

	func testEachExemptionOpensTheEarlierBuildsDefaultsOnlyForItsOneMigrationRead() throws {
		var opened: [String: Int] = [:]
		for source in try sources(excluding: Self.compiledOnlyIntoTheApp)
		where Self.mayOpenTheEarlierBuildsDefaults[source.path] != nil {
			opened[source.path] = try openings(in: source.text)
		}

		XCTAssertEqual(
			opened, Self.mayOpenTheEarlierBuildsDefaults,
			"an exemption covers one migration read; a second opening in the same file is shared state hiding behind it, and a missing one is an exemption that outlived its reason"
		)
	}

	func testEveryReaderOfTheSharedContainerGoesThroughAKnownDoor() throws {
		let resolvers = try sources(excluding: Self.neverShipped)
			.filter { $0.text.contains("forSecurityApplicationGroupIdentifier") }
			.map(\.path)
			.sorted()

		XCTAssertEqual(
			resolvers, Self.mayResolveTheSharedContainer,
			"""
			the set of files that resolve the App Group container is pinned so that new shared state has \
			to go through AppGroupStore, which cannot hold a copy of what it reads. Add a store, not a \
			container path.
			"""
		)
	}
}
