import XCTest
@testable import Readplace

final class MultipartFormTests: XCTestCase {
	private func temporaryFile() -> URL {
		FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).multipart")
	}

	/// The body `ReadplaceAPI` built inline before the form was extracted, byte for
	/// byte. The extraction moved a wire format the server already parses, so the
	/// test that matters is that it still produces exactly those bytes.
	private func inlineBody(
		boundary: String,
		submittedURL: String,
		content: Data,
		mediaType: String,
		title: String?
	) -> Data {
		func append(_ data: inout Data, _ string: String) { data.append(Data(string.utf8)) }
		var body = Data()
		append(&body, "--\(boundary)\r\n")
		append(&body, "Content-Disposition: form-data; name=\"url\"\r\n\r\n")
		append(&body, "\(submittedURL)\r\n")
		append(&body, "--\(boundary)\r\n")
		append(&body, "Content-Disposition: form-data; name=\"mediaType\"\r\n\r\n")
		append(&body, "\(mediaType)\r\n")
		if let title, !title.isEmpty {
			append(&body, "--\(boundary)\r\n")
			append(&body, "Content-Disposition: form-data; name=\"title\"\r\n\r\n")
			append(&body, "\(title)\r\n")
		}
		append(&body, "--\(boundary)\r\n")
		append(&body, "Content-Disposition: form-data; name=\"content\"; filename=\"content\"\r\n\r\n")
		body.append(content)
		append(&body, "\r\n")
		append(&body, "--\(boundary)--\r\n")
		return body
	}

	private func form(boundary: String, textParts: [MultipartForm.TextPart], content: Data) -> MultipartForm {
		MultipartForm(
			boundary: boundary,
			textParts: textParts,
			filePart: MultipartForm.FilePart(name: "content", filename: "content", bytes: content)
		)
	}

	func testWritesTheSameBytesTheInlineBuilderProduced() throws {
		let boundary = "BOUNDARY-1"
		let content = Data("<html><body>hi</body></html>".utf8)
		let file = temporaryFile()

		try form(
			boundary: boundary,
			textParts: [
				MultipartForm.TextPart(name: "url", value: "https://example.com/post"),
				MultipartForm.TextPart(name: "mediaType", value: "text/html"),
				MultipartForm.TextPart(name: "title", value: "Captured"),
			],
			content: content
		).write(to: file)

		XCTAssertEqual(
			try Data(contentsOf: file),
			inlineBody(
				boundary: boundary,
				submittedURL: "https://example.com/post",
				content: content,
				mediaType: "text/html",
				title: "Captured"
			)
		)
	}

	func testWritesTheSameBytesWithNoTitlePart() throws {
		let boundary = "BOUNDARY-2"
		let content = Data("%PDF-1.7 body".utf8)
		let file = temporaryFile()

		try form(
			boundary: boundary,
			textParts: [
				MultipartForm.TextPart(name: "url", value: "https://example.com/paper.pdf"),
				MultipartForm.TextPart(name: "mediaType", value: "application/pdf"),
			],
			content: content
		).write(to: file)

		XCTAssertEqual(
			try Data(contentsOf: file),
			inlineBody(
				boundary: boundary,
				submittedURL: "https://example.com/paper.pdf",
				content: content,
				mediaType: "application/pdf",
				title: nil
			)
		)
	}

	func testTheInMemoryBodyIsTheSameBytesTheStagedFileCarries() throws {
		let file = temporaryFile()
		let subject = form(
			boundary: "BOUNDARY-5",
			textParts: [
				MultipartForm.TextPart(name: "url", value: "https://example.com/post"),
				MultipartForm.TextPart(name: "mediaType", value: "text/html"),
			],
			content: Data("<html><body>hi</body></html>".utf8)
		)

		try subject.write(to: file)

		XCTAssertEqual(
			subject.body, try Data(contentsOf: file),
			"a foreground request and a staged upload must put the same bytes on the wire"
		)
	}

	func testDeclaresTheBoundaryInItsContentType() {
		XCTAssertEqual(
			form(boundary: "abc-123", textParts: [], content: Data()).contentType,
			"multipart/form-data; boundary=abc-123"
		)
	}

	func testWrittenBodyParsesBackIntoItsParts() throws {
		let file = temporaryFile()
		let content = Data([0x00, 0xFF, 0x0D, 0x0A, 0x2D, 0x2D])
		let subject = form(
			boundary: "BOUNDARY-3",
			textParts: [MultipartForm.TextPart(name: "mediaType", value: "application/pdf")],
			content: content
		)

		try subject.write(to: file)

		let parts = TestSupport.multipartParts(contentType: subject.contentType, body: try Data(contentsOf: file))
		XCTAssertEqual(parts.first { $0.name == "mediaType" }?.text, "application/pdf")
		XCTAssertEqual(parts.first { $0.name == "content" }?.body, content, "binary content survives the framing unaltered")
		XCTAssertEqual(parts.first { $0.name == "content" }?.filename, "content")
	}

	func testOverwritesAFileLeftAtThatPath() throws {
		let file = temporaryFile()
		try Data(repeating: 0x41, count: 4096).write(to: file)
		let subject = form(
			boundary: "BOUNDARY-4",
			textParts: [MultipartForm.TextPart(name: "url", value: "https://example.com/post")],
			content: Data("short".utf8)
		)

		try subject.write(to: file)

		XCTAssertEqual(try Data(contentsOf: file), inlineBodyForSingleURLPart(subject: subject))
	}

	private func inlineBodyForSingleURLPart(subject: MultipartForm) -> Data {
		var body = Data()
		body.append(Data("--\(subject.boundary)\r\n".utf8))
		body.append(Data("Content-Disposition: form-data; name=\"url\"\r\n\r\n".utf8))
		body.append(Data("https://example.com/post\r\n".utf8))
		body.append(Data("--\(subject.boundary)\r\n".utf8))
		body.append(Data("Content-Disposition: form-data; name=\"content\"; filename=\"content\"\r\n\r\n".utf8))
		body.append(subject.filePart.bytes)
		body.append(Data("\r\n".utf8))
		body.append(Data("--\(subject.boundary)--\r\n".utf8))
		return body
	}
}
