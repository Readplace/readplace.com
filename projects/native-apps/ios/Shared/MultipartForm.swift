import Foundation

/// A `multipart/form-data` body — the text parts, then one file part — in the
/// order the server's parser expects. Kept apart from any request so the body can
/// be written straight to disk: the share extension hands the background session
/// a file, and never holds a second copy of the content in a memory budget that
/// cannot afford one.
struct MultipartForm {
	struct TextPart: Equatable {
		let name: String
		let value: String
	}

	/// The `filename` attribute is what makes the server treat this part as a file
	/// rather than a text field.
	struct FilePart: Equatable {
		let name: String
		let filename: String
		let bytes: Data
	}

	let boundary: String
	let textParts: [TextPart]
	let filePart: FilePart

	var contentType: String { "multipart/form-data; boundary=\(boundary)" }

	/// Writes the body around `filePart.bytes` rather than into a buffer that
	/// duplicates them — the whole reason the body is file-backed.
	func write(to url: URL) throws {
		FileManager.default.createFile(atPath: url.path, contents: nil)
		let handle = try FileHandle(forWritingTo: url)
		defer { try? handle.close() }
		try handle.write(contentsOf: preamble)
		try handle.write(contentsOf: filePart.bytes)
		try handle.write(contentsOf: epilogue)
	}

	private var preamble: Data {
		var data = Data()
		for part in textParts {
			data.append("--\(boundary)\r\n")
			data.append("Content-Disposition: form-data; name=\"\(part.name)\"\r\n\r\n")
			data.append("\(part.value)\r\n")
		}
		data.append("--\(boundary)\r\n")
		data.append("Content-Disposition: form-data; name=\"\(filePart.name)\"; filename=\"\(filePart.filename)\"\r\n\r\n")
		return data
	}

	private var epilogue: Data {
		var data = Data()
		data.append("\r\n")
		data.append("--\(boundary)--\r\n")
		return data
	}
}

private extension Data {
	mutating func append(_ string: String) {
		append(Data(string.utf8))
	}
}
