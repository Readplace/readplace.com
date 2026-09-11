import XCTest

@testable import Readplace

private struct Pick: AppGroupValue {
	static let fileName = "pick-under-test.json"
	static let unwritten = Pick(chosen: [])
	let chosen: Set<String>
}

final class AppGroupStoreTests: XCTestCase {
	private func container() -> AppGroupContainer {
		AppGroupContainer(url: TestSupport.temporaryContainer())
	}

	private func fileURL(in container: AppGroupContainer) -> URL {
		container.url
			.appendingPathComponent("Library/Application Support", isDirectory: true)
			.appendingPathComponent(Pick.fileName, isDirectory: false)
	}

	func testAStoreHoldsOnlyTheLocationOfItsValueAndNeverTheValue() {
		let children = Mirror(reflecting: AppGroupStore<Pick>(container: container())).children

		XCTAssertEqual(
			children.count, 1,
			"a second stored property is somewhere to keep a copy, and a copy is what a warm process serves after the other one writes"
		)
		XCTAssertTrue(
			children.first?.value is URL,
			"the one thing a cross-process store may hold is where the value lives, never the value"
		)
	}

	func testAValueReplacedOnDiskByAnotherWriterIsReadByAStoreThatAlreadyReadIt() throws {
		let container = container()
		let store = AppGroupStore<Pick>(container: container)
		store.update { _ in Pick(chosen: ["/queue?queue=work"]) }
		XCTAssertEqual(store.stored.chosen, ["/queue?queue=work"], "precondition: the store has read once")

		try JSONEncoder().encode(Pick(chosen: ["/queue?queue=home"]))
			.write(to: fileURL(in: container), options: .atomic)

		XCTAssertEqual(
			store.stored.chosen, ["/queue?queue=home"],
			"the share extension is another process; a store that answered from its own last read would serve a choice the reader has already changed"
		)
	}

	func testAValueDeletedOnDiskByAnotherWriterStopsBeingRead() throws {
		let container = container()
		let store = AppGroupStore<Pick>(container: container)
		store.update { _ in Pick(chosen: ["/queue?queue=work"]) }
		XCTAssertEqual(store.stored.chosen, ["/queue?queue=work"], "precondition: the store has read once")

		try FileManager.default.removeItem(at: fileURL(in: container))

		XCTAssertEqual(
			store.stored.chosen, [],
			"a warm process once served a key three hours after it left disk; nothing here may outlive its file"
		)
	}

	func testAStoreWithNothingWrittenYetHoldsTheUnwrittenValue() {
		XCTAssertEqual(AppGroupStore<Pick>(container: container()).stored.chosen, [])
	}

	func testUnreadableBytesReadAsTheUnwrittenValueRatherThanAsADecodedOne() throws {
		let container = container()
		let url = fileURL(in: container)
		try FileManager.default.createDirectory(
			at: url.deletingLastPathComponent(), withIntermediateDirectories: true
		)
		try Data("not json".utf8).write(to: url, options: .atomic)

		XCTAssertEqual(
			AppGroupStore<Pick>(container: container).stored.chosen, [],
			"a hand-edited or foreign file is no answer, not a decoded one"
		)
	}

	func testAnUpdateIsHandedWhatIsOnDiskRatherThanWhatTheCallerLastSaw() {
		let store = AppGroupStore<Pick>(container: container())
		store.update { _ in Pick(chosen: ["/queue?queue=work"]) }

		var seen: Set<String>?
		store.update { current in
			seen = current.chosen
			return Pick(chosen: [])
		}

		XCTAssertEqual(
			seen, ["/queue?queue=work"],
			"writing through a transform is what stops a caller computing the next value from a read it took earlier"
		)
	}

	func testAnEarlierBuildsValueIsAdoptedWhenNothingHasBeenWrittenYet() {
		let store = AppGroupStore<Pick>(container: container())
			.adoptingLegacy { Pick(chosen: ["/queue?queue=work"]) }

		XCTAssertEqual(
			store.stored.chosen, ["/queue?queue=work"],
			"an upgrade must not silently drop what the reader already told this build's predecessor"
		)
	}

	func testAnEarlierBuildsValueNeverOverwritesOneThisBuildAlreadyWrote() {
		let container = container()
		AppGroupStore<Pick>(container: container).update { _ in Pick(chosen: ["/queue?queue=home"]) }

		let store = AppGroupStore<Pick>(container: container)
			.adoptingLegacy { Pick(chosen: ["/queue?queue=work"]) }

		XCTAssertEqual(
			store.stored.chosen, ["/queue?queue=home"],
			"the old medium is read once on the way in; after that it is history, not a second opinion"
		)
	}

	func testNothingIsWrittenWhenTheEarlierBuildRecordedNothing() {
		let container = container()

		_ = AppGroupStore<Pick>(container: container).adoptingLegacy { nil }

		XCTAssertFalse(
			FileManager.default.fileExists(atPath: fileURL(in: container).path),
			"a fresh install has no history to adopt, and inventing a file would answer a question nobody asked"
		)
	}

	func testTheEntitledAppGroupResolvesToTheContainerTheSystemGrantsIt() throws {
		let group = TokenStore.resolvedAppGroupId
		let granted = try XCTUnwrap(
			FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
			"the App Group this build is entitled to must resolve to a container"
		)

		XCTAssertEqual(AppGroupContainer.entitled(appGroupId: group)?.url, granted)
	}

	func testAnAppGroupThisBuildIsNotEntitledToResolvesToNoContainer() {
		XCTAssertNil(AppGroupContainer.entitled(appGroupId: "group.com.readplace.not-entitled"))
	}
}
