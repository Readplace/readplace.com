import XCTest
@testable import Readplace

final class IsArticleDownloadURLTests: XCTestCase {
	func testRecognisesOurOwnEpubLink() {
		let url = URL(string: "https://readplace.com/view/example.com/a?format=epub")!
		XCTAssertTrue(isArticleDownloadURL(url))
	}

	func testRecognisesTheLinkAlongsideItsTrackingParameters() {
		let url = URL(
			string: "https://readplace.com/view/example.com/a?format=epub&utm_source=reader&utm_medium=internal"
		)!
		XCTAssertTrue(isArticleDownloadURL(url))
	}

	func testRejectsAnotherHostsEpubRoute() {
		let url = URL(string: "https://example.com/view?format=epub")!
		XCTAssertFalse(isArticleDownloadURL(url))
	}

	func testRejectsOurOwnNonDownloadPage() {
		let url = URL(string: "https://readplace.com/view/example.com/a")!
		XCTAssertFalse(isArticleDownloadURL(url))
	}

	func testRejectsAnotherFormat() {
		let url = URL(string: "https://readplace.com/view/example.com/a?format=pdf")!
		XCTAssertFalse(isArticleDownloadURL(url))
	}

	func testRejectsASchemeWithNoHost() {
		let url = URL(string: "mailto:hello@readplace.com")!
		XCTAssertFalse(isArticleDownloadURL(url))
	}
}

final class ArticleDownloadDestinationTests: XCTestCase {
	private let directory = URL(fileURLWithPath: "/tmp/downloads", isDirectory: true)

	func testKeepsTheServerSuppliedFilename() {
		XCTAssertEqual(
			articleDownloadDestination(suggestedFilename: "hello-world.epub", in: directory).path,
			"/tmp/downloads/hello-world.epub"
		)
	}

	/// The name comes from the server's `Content-Disposition`, so it is text from
	/// the network reaching the filesystem: only the last component may survive.
	func testKeepsOnlyTheLastPathComponent() {
		XCTAssertEqual(
			articleDownloadDestination(suggestedFilename: "../../etc/passwd", in: directory).path,
			"/tmp/downloads/passwd"
		)
	}

	func testRejectsADotOnlyName() {
		XCTAssertEqual(
			articleDownloadDestination(suggestedFilename: "..", in: directory).path,
			"/tmp/downloads/article.epub"
		)
	}

	func testRejectsAnEmptyName() {
		XCTAssertEqual(
			articleDownloadDestination(suggestedFilename: "", in: directory).path,
			"/tmp/downloads/article.epub"
		)
	}

	func testRejectsATrailingSlashName() {
		XCTAssertEqual(
			articleDownloadDestination(suggestedFilename: "downloads/", in: directory).path,
			"/tmp/downloads/downloads"
		)
	}
}
