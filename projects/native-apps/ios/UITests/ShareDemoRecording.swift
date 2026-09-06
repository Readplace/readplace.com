import XCTest

struct ShareDemoSettings: Decodable {
	let email: String
	let password: String
	let articleTitle: String
	let eventsPath: String
	let shotDir: String
}

final class ShareDemoRecording: XCTestCase {
	static let settingsPath = "/tmp/readplace-share-demo.json"
	private var settings: ShareDemoSettings?
	private var events: FileHandle?
	private var shot = 0

	override func setUpWithError() throws {
		continueAfterFailure = true
		let data = try Data(contentsOf: URL(fileURLWithPath: ShareDemoRecording.settingsPath))
		let decoded = try JSONDecoder().decode(ShareDemoSettings.self, from: data)
		settings = decoded
		try? FileManager.default.createDirectory(
			atPath: decoded.shotDir, withIntermediateDirectories: true)
		FileManager.default.createFile(atPath: decoded.eventsPath, contents: nil)
		events = FileHandle(forWritingAtPath: decoded.eventsPath)
	}

	override func tearDownWithError() throws {
		try events?.close()
	}

	private func capture(_ name: String) {
		guard let dir = settings?.shotDir else { return }
		shot += 1
		let png = XCUIScreen.main.screenshot().pngRepresentation
		try? png.write(to: URL(fileURLWithPath: "\(dir)/\(shot)-\(name).png"))
	}

	private func emit(_ label: String, kind: String, element: XCUIElement?) {
		let scale = XCUIScreen.main.screenshot().image.scale
		var line = "{\"wallMs\":\(Int(Date().timeIntervalSince1970 * 1000)),\"label\":\"\(label)\",\"kind\":\"\(kind)\""
		if let element {
			let frame = element.frame
			line += ",\"x\":\(Int(frame.midX * scale)),\"y\":\(Int(frame.midY * scale))"
		}
		line += "}\n"
		if let data = line.data(using: .utf8) { events?.write(data) }
	}

	private func tap(_ element: XCUIElement, _ label: String, timeout: TimeInterval = 20) {
		XCTAssertTrue(element.waitForExistence(timeout: timeout), "\(label) must appear")
		emit(label, kind: "tap", element: element)
		element.tap()
	}

	func testSignIn() throws {
		let settings = try XCTUnwrap(self.settings)
		let app = XCUIApplication(bundleIdentifier: "com.readplace")
		app.activate()
		Thread.sleep(forTimeInterval: 6)
		capture("launched")

		let login = app.buttons["Login"]
		guard login.waitForExistence(timeout: 20) else {
			capture("already-signed-in")
			return
		}
		login.tap()
		Thread.sleep(forTimeInterval: 3)
		capture("after-login-tap")

		let consent = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Continue"]
		if consent.waitForExistence(timeout: 15) {
			consent.tap()
			Thread.sleep(forTimeInterval: 4)
		}
		capture("after-consent")

		let approveButton = app.buttons.matching(NSPredicate(format: "label ==[c] 'approve'")).firstMatch
		if !approveButton.waitForExistence(timeout: 8) {
			let email = app.textFields.firstMatch
			XCTAssertTrue(email.waitForExistence(timeout: 30), "the sign-in form must load")
			email.tap()
			Thread.sleep(forTimeInterval: 1)
			app.typeText(settings.email)
			Thread.sleep(forTimeInterval: 1)
			capture("email-typed")

			app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45))
				.press(
					forDuration: 0.1,
					thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.22)))
			Thread.sleep(forTimeInterval: 2)
			let password = app.secureTextFields.firstMatch
			XCTAssertTrue(password.waitForExistence(timeout: 10), "the password field must be reachable")
			password.tap()
			Thread.sleep(forTimeInterval: 2)
			app.typeText(settings.password)
			Thread.sleep(forTimeInterval: 1)
			capture("password-typed")

			app.typeText("\n")
			Thread.sleep(forTimeInterval: 3)
			let submit = app.buttons.matching(NSPredicate(format: "label ==[c] 'sign in'")).firstMatch
			if submit.exists, submit.isHittable { submit.tap() }
			Thread.sleep(forTimeInterval: 8)
			capture("after-submit")
		}

		let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
		for label in ["Not Now", "Never for This Website"] {
			let dismiss = springboard.buttons[label]
			if dismiss.exists, dismiss.isHittable {
				dismiss.tap()
				Thread.sleep(forTimeInterval: 3)
				break
			}
		}
		capture("password-prompt-dismissed")

		let approve = app.buttons.matching(NSPredicate(format: "label ==[c] 'approve'")).firstMatch
		if approve.waitForExistence(timeout: 25) {
			approve.tap()
			Thread.sleep(forTimeInterval: 8)
		}
		capture("after-approve")

		let list = app.staticTexts["Reading List"]
		let reached = list.waitForExistence(timeout: 40)
		capture(reached ? "reading-list" : "not-signed-in")
		XCTAssertTrue(reached, "the app must reach the reading list")
	}

	func testRecordShareDemo() throws {
		let settings = try XCTUnwrap(self.settings)
		let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
		safari.activate()
		XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 20), "Safari must be in front")
		Thread.sleep(forTimeInterval: 3)

		tap(safari.buttons["MoreMenuButton"], "safari-menu")
		Thread.sleep(forTimeInterval: 2)
		tap(safari.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'share'")).firstMatch, "share")
		Thread.sleep(forTimeInterval: 4)
		tap(safari.cells.matching(NSPredicate(format: "label == 'Readplace'")).firstMatch, "readplace")

		Thread.sleep(forTimeInterval: 7)
		emit("sheet-dismissed", kind: "marker", element: nil)
		let app = XCUIApplication(bundleIdentifier: "com.readplace")
		app.activate()
		let saved = app.staticTexts.matching(
			NSPredicate(format: "label CONTAINS %@", settings.articleTitle)).firstMatch
		XCTAssertTrue(saved.waitForExistence(timeout: 40), "the saved article must reach the reading list")
		emit("row-visible", kind: "marker", element: nil)
		Thread.sleep(forTimeInterval: 4)
	}
}
