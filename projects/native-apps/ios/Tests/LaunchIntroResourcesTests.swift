import AVFoundation
import XCTest
@testable import Readplace

final class LaunchIntroResourcesTests: XCTestCase {
	func testTheIntroVideoShipsInTheBundle() {
		XCTAssertNotNil(Bundle.main.url(forResource: "LaunchIntro", withExtension: "mp4"))
	}

	func testTheIntroThemeShipsInTheBundle() {
		XCTAssertNotNil(Bundle.main.url(forResource: "LaunchIntroTheme", withExtension: "caf"))
	}

	func testTheIntroVideoShipsWithNoAudioTrack() async throws {
		let url = try XCTUnwrap(Bundle.main.url(forResource: "LaunchIntro", withExtension: "mp4"))
		let tracks = try await AVURLAsset(url: url).loadTracks(withMediaType: .audio)

		XCTAssertTrue(tracks.isEmpty, "the intro video's own audio is stripped; the looping theme is the only sound")
	}

	func testTheDeclaredVideoDurationMatchesTheShippedAsset() async throws {
		let url = try XCTUnwrap(Bundle.main.url(forResource: "LaunchIntro", withExtension: "mp4"))
		let duration = try await AVURLAsset(url: url).load(.duration)

		XCTAssertEqual(
			duration.seconds,
			LaunchIntro.videoDuration,
			accuracy: 0.05,
			"skip jumps the music to LaunchIntro.videoDuration; it must track the real asset length"
		)
	}
}
