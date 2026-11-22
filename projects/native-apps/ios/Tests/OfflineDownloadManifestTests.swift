import XCTest
@testable import Readplace

@MainActor
final class OfflineDownloadManifestTests: XCTestCase {
	private let container = AppGroupContainer(url: TestSupport.temporaryContainer())

	private func article(id: String, contentVersion: String?) throws -> Article {
		let json = Fixtures.article(id: id, contentVersion: contentVersion)
		return try XCTUnwrap(Article(entity: JSONDecoder().decode(SirenEntity.self, from: Data(json.utf8))))
	}

	func testAnArticleIsOfflineOnlyAtTheVersionThatWasDownloaded() throws {
		let manifest = OfflineDownloadManifest(container: container)
		manifest.recordDownloaded(articleId: "a1", contentVersion: "v1", contentState: nil)

		XCTAssertTrue(manifest.isAvailableOffline(try article(id: "a1", contentVersion: "v1")))
		XCTAssertFalse(
			manifest.isAvailableOffline(try article(id: "a1", contentVersion: "v2")),
			"a re-crawl changes the version, so the stored copy no longer counts"
		)
		XCTAssertFalse(manifest.isAvailableOffline(try article(id: "a2", contentVersion: "v1")))
		XCTAssertFalse(
			manifest.isAvailableOffline(try article(id: "a1", contentVersion: nil)),
			"a server that names no version can never confirm a copy is current"
		)
	}

	func testTheManifestSurvivesARelaunch() {
		let manifest = OfflineDownloadManifest(container: container)
		manifest.recordDownloaded(articleId: "a1", contentVersion: "v1", contentState: nil)
		manifest.record(run: OfflineDownloadRun(total: 10, completed: 4))

		let relaunched = OfflineDownloadManifest(container: container)

		XCTAssertTrue(relaunched.isCurrent(articleId: "a1", contentVersion: "v1"))
		XCTAssertEqual(relaunched.incompleteRun, OfflineDownloadRun(total: 10, completed: 4))
	}

	func testOnlyARunThatStoppedShortIsOfferedToContinue() {
		let manifest = OfflineDownloadManifest(container: container)
		XCTAssertNil(manifest.incompleteRun)

		manifest.record(run: OfflineDownloadRun(total: 3, completed: 3))
		XCTAssertNil(manifest.incompleteRun)
		XCTAssertEqual(manifest.run, OfflineDownloadRun(total: 3, completed: 3))

		manifest.forgetRun()
		XCTAssertNil(manifest.run)
	}

	func testAManifestWrittenBeforeContentStatesStillLoads() throws {
		let directory = OfflineReadingFiles.directory(in: container)
		try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
		try Data(#"{"versions":{"a1":"v1"},"run":{"total":4,"completed":1}}"#.utf8)
			.write(to: directory.appendingPathComponent("download-manifest.json"))

		let manifest = OfflineDownloadManifest(container: container)

		XCTAssertTrue(manifest.isCurrent(articleId: "a1", contentVersion: "v1"))
		XCTAssertEqual(manifest.run, OfflineDownloadRun(total: 4, completed: 1))
		XCTAssertNil(manifest.contentState(articleId: "a1"))
	}

	func testAContentStateIsRecordedReplacedAndSurvivesARelaunch() {
		let manifest = OfflineDownloadManifest(container: container)
		manifest.recordDownloaded(articleId: "a1", contentVersion: "v1", contentState: .processing)
		XCTAssertEqual(manifest.contentState(articleId: "a1"), .processing)

		manifest.recordDownloaded(articleId: "a1", contentVersion: "v2", contentState: .available)
		manifest.record(contentState: .unavailable, articleId: "a2")

		let relaunched = OfflineDownloadManifest(container: container)
		XCTAssertEqual(relaunched.contentState(articleId: "a1"), .available)
		XCTAssertEqual(relaunched.contentState(articleId: "a2"), .unavailable)
	}

	func testOnlyAnArticleAmongThoseGivenWithARecordedStateOtherThanAvailableLacksContent() {
		let manifest = OfflineDownloadManifest(container: container)
		manifest.recordDownloaded(articleId: "gone", contentVersion: "v1", contentState: .unavailable)
		manifest.recordDownloaded(articleId: "fine", contentVersion: "v1", contentState: .available)
		manifest.recordDownloaded(articleId: "old", contentVersion: "v1", contentState: nil)
		manifest.recordDownloaded(articleId: "pending", contentVersion: "v1", contentState: .processing)

		XCTAssertFalse(
			manifest.hasArticlesWithoutContent(among: ["fine", "old", "never-downloaded"]),
			"an unavailable article that is not among the ids given, and one stored before states were recorded, do not count"
		)
		XCTAssertTrue(manifest.hasArticlesWithoutContent(among: ["fine", "gone"]))
		XCTAssertTrue(manifest.hasArticlesWithoutContent(among: ["pending"]))
	}

	func testACorruptManifestStartsEmpty() throws {
		let directory = OfflineReadingFiles.directory(in: container)
		try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
		try Data("not json".utf8).write(to: directory.appendingPathComponent("download-manifest.json"))

		let manifest = OfflineDownloadManifest(container: container)

		XCTAssertNil(manifest.run)
		XCTAssertFalse(manifest.isCurrent(articleId: "a1", contentVersion: "v1"))
	}
}
