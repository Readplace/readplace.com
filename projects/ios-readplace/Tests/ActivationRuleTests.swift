import Foundation
import XCTest

/// The share extension's `NSExtensionActivationRule` is load-bearing config no
/// compiler checks: a malformed predicate silently removes the app from every
/// share sheet. These tests evaluate the exact plist string as a real
/// `NSPredicate` against the attachment shapes iOS hosts are documented to
/// produce (Apple Dev Forums 110219/108923/734526), so a plist edit that breaks
/// activation fails here instead of on devices.
final class ActivationRuleTests: XCTestCase {
	private func activationRule() throws -> NSPredicate {
		let plist = URL(fileURLWithPath: #filePath)
			.deletingLastPathComponent()
			.deletingLastPathComponent()
			.appendingPathComponent("ShareExtension/Info.plist")
		let data = try Data(contentsOf: plist)
		let root = try XCTUnwrap(
			try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
		)
		let extensionDict = try XCTUnwrap(root["NSExtension"] as? [String: Any])
		let attributes = try XCTUnwrap(extensionDict["NSExtensionAttributes"] as? [String: Any])
		let rule = try XCTUnwrap(
			attributes["NSExtensionActivationRule"] as? String,
			"the activation rule must be the SUBQUERY predicate string, not the dictionary form"
		)
		return NSPredicate(format: rule)
	}

	private func item(_ attachments: [[String]]) -> [String: Any] {
		["attachments": attachments.map { ["registeredTypeIdentifiers": $0] }]
	}

	private func assertRule(
		matches expected: Bool, _ items: [[String: Any]], _ shape: String,
		file: StaticString = #filePath, line: UInt = #line
	) throws {
		let matched = try activationRule().evaluate(with: ["extensionItems": items])
		XCTAssertEqual(matched, expected, shape, file: file, line: line)
	}

	func testAcceptsEveryPayloadShapeTheExtensionCanHandle() throws {
		try assertRule(matches: true, [item([["public.url"]])],
			"a plain web link — long-press share, or an app sharing a URL")
		try assertRule(matches: true, [item([["com.adobe.pdf", "public.file-url"]])],
			"Safari's PDF viewer sharing only the document")
		try assertRule(matches: true, [item([["public.url"], ["com.adobe.pdf", "public.file-url"]])],
			"Safari's PDF viewer sharing the web URL alongside the document")
		try assertRule(matches: true, [item([["public.plain-text"]])],
			"a plain text share the extension scrapes a URL from")
		try assertRule(matches: true, [item([["public.url", "public.plain-text"]])],
			"a URL and its text carried in one attachment (Chrome-style)")
		try assertRule(matches: true, [item([["public.url"]]), item([["public.plain-text"]])],
			"a URL item plus a text item as two extension items")
		try assertRule(matches: true, [item([["public.jpeg"]]), item([["public.url"]])],
			"an unmatchable item must not veto a fully-supported URL item")
		try assertRule(matches: true, [item([["public.plain-text", "public.file-url"]]), item([["public.url"]])],
			"a text file item must not veto a fully-supported URL item")
	}

	func testRejectsEveryPayloadShapeTheExtensionCannotHandle() throws {
		try assertRule(matches: false, [item([["org.openxmlformats.wordprocessingml.document", "public.file-url"]])],
			"a non-PDF document from the Files app")
		try assertRule(matches: false, [item([["public.jpeg"]])],
			"a photo share")
		try assertRule(matches: false, [item([["public.file-url"]])],
			"a bare file URL — a sandbox path is never a saveable article link")
		try assertRule(matches: false, [item([["public.mpeg-4"]])],
			"a video share")
		try assertRule(matches: false, [item([])],
			"an attachment-less item must not match vacuously")
		try assertRule(matches: false, [item([]), item([["public.jpeg"]])],
			"an empty item must not sneak an unmatchable payload past the rule")
		try assertRule(matches: false, [item([["public.plain-text", "public.file-url"]])],
			"a .txt file from the Files app — file-backed text is not a text share")
		try assertRule(
			matches: false,
			[item([["public.comma-separated-values-text", "public.plain-text", "public.file-url"]])],
			"a .csv file — conforms to plain-text but is still a file"
		)
	}
}
