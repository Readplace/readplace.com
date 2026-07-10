import UniformTypeIdentifiers
import XCTest
@testable import Readplace

@MainActor
final class ShareURLExtractorTests: XCTestCase {
	private func item(_ providers: [NSItemProvider], title: String? = nil) -> NSExtensionItem {
		let item = NSExtensionItem()
		item.attachments = providers
		if let title { item.attributedContentText = NSAttributedString(string: title) }
		return item
	}

	private func urlProvider(_ string: String) -> NSItemProvider {
		NSItemProvider(item: URL(string: string)! as NSURL, typeIdentifier: UTType.url.identifier)
	}

	private func textProvider(_ text: String) -> NSItemProvider {
		NSItemProvider(item: text as NSString, typeIdentifier: UTType.plainText.identifier)
	}

	/// A PDF item provider backed by a real temp file so `loadFileRepresentation`
	/// and the size check run. A `truncate`d sparse file gives a large logical size
	/// without writing megabytes.
	private func pdfProvider(logicalSize: Int = 64, name: String = "doc.pdf") throws -> NSItemProvider {
		let dir = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(UUID().uuidString, isDirectory: true)
		try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
		let url = dir.appendingPathComponent(name)
		var bytes = Data("%PDF-1.4\n".utf8)
		if logicalSize > bytes.count { bytes.append(Data(count: min(logicalSize - bytes.count, 4096))) }
		try bytes.write(to: url)
		if logicalSize > bytes.count {
			let handle = try FileHandle(forWritingTo: url)
			try handle.truncate(atOffset: UInt64(logicalSize))
			try handle.close()
		}
		let provider = try XCTUnwrap(NSItemProvider(contentsOf: url))
		provider.suggestedName = name
		return provider
	}

	func testExtractsAWebURL() async {
		let shared = await ShareURLExtractor.extract(from: [item([urlProvider("https://example.com/post")])])
		XCTAssertEqual(shared?.url?.absoluteString, "https://example.com/post")
		XCTAssertNil(shared?.pdfProvider)
	}

	func testExtractsAURLFromPlainText() async {
		let shared = await ShareURLExtractor.extract(from: [item([textProvider("read this https://example.com/p ok")])])
		XCTAssertEqual(shared?.url?.absoluteString, "https://example.com/p")
	}

	func testExtractsURLDeliveredAsData() async {
		let data = URL(string: "https://example.com/d")!.dataRepresentation
		let provider = NSItemProvider(item: data as NSData, typeIdentifier: UTType.url.identifier)
		let shared = await ShareURLExtractor.extract(from: [item([provider])])
		XCTAssertEqual(shared?.url?.absoluteString, "https://example.com/d")
	}

	func testExtractsURLDeliveredAsString() async {
		let provider = NSItemProvider(item: "https://example.com/s" as NSString, typeIdentifier: UTType.url.identifier)
		let shared = await ShareURLExtractor.extract(from: [item([provider])])
		XCTAssertEqual(shared?.url?.absoluteString, "https://example.com/s")
	}

	func testIgnoresANonWebURL() async {
		let shared = await ShareURLExtractor.extract(from: [item([urlProvider("mailto:a@b.com")])])
		XCTAssertNil(shared, "a mailto link is not a web URL and there is no PDF, so nothing is saveable")
	}

	func testFindsURLAndPDFAcrossSeparateItems() async throws {
		let shared = await ShareURLExtractor.extract(from: [
			item([urlProvider("https://example.com/a")]),
			item([try pdfProvider()]),
		])
		XCTAssertEqual(shared?.url?.absoluteString, "https://example.com/a")
		XCTAssertNotNil(shared?.pdfProvider)
	}

	func testTitleComesFromAttributedContentText() async {
		let shared = await ShareURLExtractor.extract(from: [item([urlProvider("https://example.com/a")], title: "My Title")])
		XCTAssertEqual(shared?.title, "My Title")
	}

	func testTitleFallsBackToPdfSuggestedNameWhenNoContentText() async throws {
		let shared = await ShareURLExtractor.extract(from: [item([try pdfProvider(name: "report.pdf")])])
		XCTAssertNil(shared?.url)
		XCTAssertNotNil(shared?.pdfProvider)
		XCTAssertEqual(shared?.title, "report.pdf", "with no content text the title falls back to the PDF's suggested name")
	}

	func testReturnsNilWhenNoURLAndNoPDF() async {
		let shared = await ShareURLExtractor.extract(from: [item([textProvider("just words, no link")])])
		XCTAssertNil(shared)
	}

	func testReturnsNilForNoItems() async {
		let shared = await ShareURLExtractor.extract(from: [])
		XCTAssertNil(shared)
	}

	func testReturnsNilForANilExtensionContext() async {
		let shared = await ShareURLExtractor.extract(from: nil)
		XCTAssertNil(shared)
	}

	func testReturnsNilForAnItemWithNoAttachments() async {
		let shared = await ShareURLExtractor.extract(from: [NSExtensionItem()])
		XCTAssertNil(shared, "an item with no attachments carries no URL and no PDF")
	}

	func testCoercesEachItemShapeAHostMayDeliver() {
		XCTAssertEqual(ShareURLExtractor.coerceURL(from: URL(string: "https://example.com/u")! as NSURL)?.absoluteString, "https://example.com/u")
		let data = URL(string: "https://example.com/d")!.dataRepresentation
		XCTAssertEqual(ShareURLExtractor.coerceURL(from: data as NSData)?.absoluteString, "https://example.com/d")
		XCTAssertEqual(ShareURLExtractor.coerceURL(from: "https://example.com/s" as NSString)?.absoluteString, "https://example.com/s")
	}

	func testCoercionRejectsAnItemThatIsNotURLShaped() {
		XCTAssertNil(ShareURLExtractor.coerceURL(from: NSNumber(value: 42)))
		XCTAssertNil(ShareURLExtractor.coerceURL(from: nil))
	}

	func testLoadsPdfDataUnderTheCeiling() async throws {
		let data = await ShareURLExtractor.loadPDFData(try pdfProvider(logicalSize: 256))
		XCTAssertEqual(data?.starts(with: Data("%PDF-".utf8)), true)
	}

	func testLoadPdfDataRejectsAnOversizeFile() async throws {
		let oversize = try pdfProvider(logicalSize: ReadplaceAPI.defaultMaxExternalContentBytes + 1)
		let data = await ShareURLExtractor.loadPDFData(oversize)
		XCTAssertNil(data, "a PDF over the extension's byte ceiling is not pulled into memory")
	}
}
