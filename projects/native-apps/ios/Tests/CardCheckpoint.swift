import UIKit
import XCTest

enum CardCheckpoint {
	// Far tighter than the Playwright suites' 0.2/0.1, which are sized for a full-page
	// browser capture. Against a 340pt card those values pass with every readlist row
	// and the Done button erased; these fail on a single changed tick.
	static let threshold = 0.02
	static let maxDiffPixelRatio = 0.0005
	static let recordingVariable = "READPLACE_RECORD_SNAPSHOTS"

	static var isRecording: Bool {
		ProcessInfo.processInfo.environment[recordingVariable] != nil
	}

	static var runtimeTag: String {
		let version = ProcessInfo.processInfo.operatingSystemVersion
		return "ios\(version.majorVersion).\(version.minorVersion)"
	}

	static func appearanceTag(_ style: UIUserInterfaceStyle) -> String {
		style == .dark ? "dark" : "light"
	}

	static func baselineDirectory(for testFile: StaticString) -> URL {
		let file = URL(fileURLWithPath: "\(testFile)")
		return file
			.deletingLastPathComponent()
			.appendingPathComponent("\(file.lastPathComponent)-snapshots", isDirectory: true)
	}

	static func baselineName(_ checkpoint: String, _ style: UIUserInterfaceStyle, runtime: String) -> String {
		"\(checkpoint)-\(runtime)-\(appearanceTag(style)).png"
	}

	static func committedNames(in directory: URL) -> [String] {
		let found = try? FileManager.default.contentsOfDirectory(atPath: directory.path)
		return (found ?? []).filter { $0.hasSuffix(".png") }.sorted()
	}

	static func coveredRuntimes(in directory: URL) -> [String] {
		let tags = committedNames(in: directory).compactMap { name -> String? in
			name.split(separator: "-").dropLast().last.map(String.init)
		}
		return Array(Set(tags)).sorted()
	}

	static let commitWindow = 0.2

	static func settle(_ view: UIView) {
		view.setNeedsLayout()
		view.layoutIfNeeded()
		RunLoop.main.run(until: Date(timeIntervalSinceNow: commitWindow))
		view.layoutIfNeeded()
	}

	static func render(_ view: UIView, style: UIUserInterfaceStyle) -> PixelBitmap {
		view.overrideUserInterfaceStyle = style
		view.semanticContentAttribute = .forceLeftToRight
		settle(view)

		let format = UIGraphicsImageRendererFormat()
		format.scale = 1
		format.opaque = true
		format.preferredRange = .standard

		let renderer = UIGraphicsImageRenderer(bounds: view.bounds, format: format)
		var bitmap = PixelBitmap(width: 0, height: 0, rgba: [])
		UIView.performWithoutAnimation {
			let image = renderer.image { context in
				let drawn = view.drawHierarchy(in: view.bounds, afterScreenUpdates: true)
				XCTAssertTrue(drawn, "the card must be in a visible window for the capture to include its SwiftUI rows")
			}
			bitmap = PixelBitmap(redrawing: image.cgImage ?? UIImage().cgImage!)
		}
		return bitmap
	}
}

extension XCTestCase {
	func assertHostIsNeutral(file: StaticString = #filePath, line: UInt = #line) {
		XCTAssertFalse(
			UIAccessibility.isReduceMotionEnabled,
			"a simulator-wide accessibility setting is a test input; reduce motion changes what renders",
			file: file, line: line
		)
		XCTAssertFalse(UIAccessibility.isReduceTransparencyEnabled, file: file, line: line)
		XCTAssertFalse(UIAccessibility.isBoldTextEnabled, file: file, line: line)
		XCTAssertFalse(UIAccessibility.isInvertColorsEnabled, file: file, line: line)
		XCTAssertEqual(
			UIApplication.shared.preferredContentSizeCategory, .large,
			"the committed baselines were minted at the default text size",
			file: file, line: line
		)
	}

	func assertLayoutIsStable(
		_ view: UIView,
		_ measured: [UIView],
		file: StaticString = #filePath,
		line: UInt = #line
	) {
		let first = measured.map(\.frame)
		view.setNeedsLayout()
		view.layoutIfNeeded()
		XCTAssertEqual(
			first, measured.map(\.frame),
			"a second layout pass moved something, so every later assertion is racing the layout engine",
			file: file, line: line
		)
	}

	func assertMatchesBaseline(
		_ view: UIView,
		checkpoint: String,
		style: UIUserInterfaceStyle,
		testFile: StaticString = #filePath,
		file: StaticString = #filePath,
		line: UInt = #line
	) {
		let rendered = CardCheckpoint.render(view, style: style)
		let directory = CardCheckpoint.baselineDirectory(for: testFile)
		let runtime = CardCheckpoint.runtimeTag
		let name = CardCheckpoint.baselineName(checkpoint, style, runtime: runtime)
		let url = directory.appendingPathComponent(name)

		attach(rendered, named: name)

		if CardCheckpoint.isRecording {
			recordBaseline(rendered, to: url, directory: directory, file: file, line: line)
			return
		}

		guard let data = try? Data(contentsOf: url), let baseline = PixelBitmap(pngData: data) else {
			XCTFail(
				"""
				no committed baseline for this runtime. Add \(name) under \
				\(directory.lastPathComponent) — the committed runtimes are \
				\(CardCheckpoint.coveredRuntimes(in: directory).joined(separator: ", ")). \
				Re-mint with: make test RECORD_SNAPSHOTS=1
				""",
				file: file, line: line
			)
			return
		}

		switch PixelComparison.compare(
			baseline: baseline,
			rendered: rendered,
			threshold: CardCheckpoint.threshold,
			maxDiffPixelRatio: CardCheckpoint.maxDiffPixelRatio
		) {
		case .match:
			return
		case .sizeMismatch(let committed, let now):
			XCTFail(
				"\(name) is \(Int(committed.width))x\(Int(committed.height)) but the card now renders "
					+ "\(Int(now.width))x\(Int(now.height)); a metric shift fails on size before any pixel budget applies",
				file: file, line: line
			)
		case .tooManyDifferentPixels(let ratio, let allowed, let differing, let total):
			XCTFail(
				"\(name) differs in \(differing) of \(total) pixels (\(ratio) > \(allowed))",
				file: file, line: line
			)
		}
	}

	private func recordBaseline(
		_ bitmap: PixelBitmap,
		to url: URL,
		directory: URL,
		file: StaticString,
		line: UInt
	) {
		try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
		try? bitmap.pngData()?.write(to: url)
		XCTFail(
			"recorded \(url.lastPathComponent). A recording run never passes — commit the baselines for "
				+ "every runtime, then re-run make test without RECORD_SNAPSHOTS",
			file: file, line: line
		)
	}

	private func attach(_ bitmap: PixelBitmap, named name: String) {
		guard let data = bitmap.pngData() else { return }
		let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.png")
		attachment.name = name
		attachment.lifetime = .keepAlways
		add(attachment)
	}
}
