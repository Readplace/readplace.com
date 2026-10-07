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
		manifest.recordDownloaded(articleId: "a1", contentVersion: "v1")

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
		manifest.recordDownloaded(articleId: "a1", contentVersion: "v1")
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

	func testACorruptManifestStartsEmpty() throws {
		let directory = OfflineReadingFiles.directory(in: container)
		try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
		try Data("not json".utf8).write(to: directory.appendingPathComponent("download-manifest.json"))

		let manifest = OfflineDownloadManifest(container: container)

		XCTAssertNil(manifest.run)
		XCTAssertFalse(manifest.isCurrent(articleId: "a1", contentVersion: "v1"))
	}
}
