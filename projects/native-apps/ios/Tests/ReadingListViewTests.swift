import XCTest
@testable import Readplace

@MainActor
final class ReadingListViewTests: XCTestCase {
	nonisolated override func setUp() {
		super.setUp()
		StubURLProtocol.reset()
	}

	private final class MusicLog {
		var restarts = 0
		var muted: Bool?
	}

	private func makeSession() -> AppSession {
		AppSession(
			store: TestSupport.loggedInStore(),
			nativeUserAgent: TestSupport.nativeUserAgent,
			sessionConfiguration: TestSupport.stubbedConfiguration(), readStorefront: { nil },
			wipeReaderWebStore: {}
		)
	}

	private func makeIntro(log: MusicLog) -> LaunchIntroModel {
		let defaults = TestSupport.ephemeralDefaults()
		_ = LaunchIntroSeen(defaults: defaults).claim()
		return LaunchIntroModel(
			seen: LaunchIntroSeen(defaults: defaults),
			music: IntroMusic(
				start: {},
				stop: {},
				restart: { log.restarts += 1 },
				seek: { _ in },
				setMuted: { log.muted = $0 }
			),
			mutePreference: IntroMutePreference(defaults: defaults),
			reduceMotion: false,
			isLoggedIn: true
		)
	}

	func testSigningOutReplaysTheIntroOnlyOnceTheSessionIsActuallyLoggedOut() async {
		StubURLProtocol.setHandler { _, _ in .json(200, "{}") }
		let session = makeSession()
		var loggedInWhenReplayed: Bool?
		var replays = 0
		let view = ReadingListView(session: session, externalBrowser: ExternalBrowser { _, completion in completion(true) }, onSignedOut: {
			replays += 1
			loggedInWhenReplayed = session.isLoggedIn
		})

		await view.signOut()

		XCTAssertFalse(session.isLoggedIn)
		XCTAssertEqual(replays, 1, "signing out plays the intro, exactly as the login screen's Replay intro does")
		XCTAssertEqual(
			loggedInWhenReplayed, false,
			"the intro plays after a *successful* sign-out, so the session must already be logged out when it starts"
		)
	}

	func testSigningOutReplaysTheIntroAndPreservesMute() async {
		StubURLProtocol.setHandler { _, _ in .json(200, "{}") }
		let session = makeSession()
		let log = MusicLog()
		let intro = makeIntro(log: log)
		intro.toggleMute()
		XCTAssertEqual(intro.phase, .idle, "a returning logged-in launch never entered the intro")
		XCTAssertTrue(intro.isMuted)

		await ReadingListView(session: session, externalBrowser: ExternalBrowser { _, completion in completion(true) }, onSignedOut: { intro.replay() }).signOut()

		XCTAssertEqual(intro.phase, .playing, "the video plays again after signing out")
		XCTAssertEqual(log.restarts, 1, "the theme restarts with it, so the video is scored")
		XCTAssertEqual(intro.isMuted, true, "signing out keeps the reader's mute choice")
		XCTAssertEqual(log.muted, true)
	}

	func testAFailedRevokeStillSignsOutAndPlaysTheIntro() async {
		StubURLProtocol.setHandler { _, _ in .json(500, "{}") }
		let session = makeSession()
		let log = MusicLog()
		let intro = makeIntro(log: log)

		await ReadingListView(session: session, externalBrowser: ExternalBrowser { _, completion in completion(true) }, onSignedOut: { intro.replay() }).signOut()

		XCTAssertFalse(session.isLoggedIn, "revocation is best-effort; the local sign-out always completes")
		XCTAssertEqual(intro.phase, .playing)
		XCTAssertEqual(log.restarts, 1)
	}

	private func hint() throws -> ReadlistHint {
		ReadlistHint(
			text: "Older saves stay elsewhere.",
			linkLabel: "Open on the web",
			url: try XCTUnwrap(URL(string: "\(AppConfig.serverBaseURL)/queue"))
		)
	}

	func testTheReadlistNameIsAnnouncedAsAHeading() {
		XCTAssertEqual(
			ReadlistHeader.nameTraits,
			.isHeader,
			"the readlist name replaces the navigation title, so VoiceOver must still reach it as the screen's heading"
		)
	}

	func testOpensTheHintsLinkThroughTheHandoffOpener() async throws {
		StubURLProtocol.setHandler { request, _ in
			request.url?.path == "/auth/handoff" ? .json(200, #"{ "code": "minted" }"#) : .json(404, "{}")
		}
		var opened: [URL] = []
		let browser = ExternalBrowser { url, completion in
			opened.append(url)
			completion(true)
		}
		let hint = try hint()
		let view = ReadingListView(session: makeSession(), externalBrowser: browser, onSignedOut: {})

		await view.openHint(hint)

		let handoff = try XCTUnwrap(browserHandoffURL(for: hint.url, code: "minted", baseURL: AppConfig.serverBaseURL))
		XCTAssertEqual(opened, [try XCTUnwrap(chromeURLFor(handoff))], "the link opens in Chrome carrying a signed-in handoff")
	}
}
