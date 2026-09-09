import XCTest
@testable import Readplace

@MainActor
final class SloganRotationTests: XCTestCase {
	private let start = Date(timeIntervalSinceReferenceDate: 1000)

	private func makeRotation() -> SloganRotation {
		SloganRotation(fallback: "Fallback.", seed: 42, intervalNanoseconds: 1_000_000, startedAt: start)
	}

	func testASloganReadsAsAReview() {
		XCTAssertEqual(sloganAsReview("It just works - Matthew Motz"), "\u{201C}It just works - Matthew Motz\u{201D}")
	}

	func testTheFallbackSloganStandsQuotedUntilAnythingIsPublished() {
		let rotation = makeRotation()

		XCTAssertEqual(rotation.current, "Fallback.")
		XCTAssertEqual(
			rotation.subtitle(at: start),
			SubtitleFrame(
				outgoing: SloganLine(text: "", pose: .hidden),
				incoming: SloganLine(text: "\u{201C}Fallback.\u{201D}", pose: .shown)
			)
		)
		XCTAssertEqual(rotation.settledSubtitle, rotation.subtitle(at: start))
	}

	func testAnEmptyPublicationKeepsTheFallback() {
		let rotation = makeRotation()

		rotation.publish([])

		XCTAssertEqual(rotation.current, "Fallback.")
	}

	func testPublishingStartsFromTheFirstEntryAndAdvancingWrapsAround() {
		let rotation = makeRotation()
		rotation.publish(["A", "B", "C"])
		XCTAssertEqual(rotation.current, "A")

		rotation.advance(at: start.addingTimeInterval(5))
		XCTAssertEqual(rotation.current, "B")
		XCTAssertEqual(
			rotation.handoff,
			SloganHandoff(outgoing: "A", incoming: "B", startedAt: 5, ordinal: 0, seed: 42),
			"the handoff is timed on the storm clock so the sky and the words agree"
		)

		rotation.advance(at: start.addingTimeInterval(20))
		rotation.advance(at: start.addingTimeInterval(35))
		XCTAssertEqual(rotation.current, "A")
		XCTAssertEqual(rotation.handoff, SloganHandoff(outgoing: "C", incoming: "A", startedAt: 35, ordinal: 2, seed: 42))
	}

	func testTheSubtitleFollowsTheHandoffOnTheStormClock() {
		let rotation = makeRotation()
		rotation.publish(["A", "B"])
		rotation.advance(at: start.addingTimeInterval(5))

		XCTAssertEqual(
			rotation.subtitle(at: start.addingTimeInterval(4)),
			SubtitleFrame(
				outgoing: SloganLine(text: "\u{201C}A\u{201D}", pose: .shown),
				incoming: SloganLine(text: "\u{201C}B\u{201D}", pose: .hidden)
			)
		)
		XCTAssertEqual(rotation.subtitle(at: start.addingTimeInterval(5.15)).outgoing.pose.opacity, 0.5, accuracy: 1e-9)
		XCTAssertEqual(
			rotation.subtitle(at: start.addingTimeInterval(5 + SloganHandoff.duration)),
			SubtitleFrame(
				outgoing: SloganLine(text: "\u{201C}A\u{201D}", pose: .hidden),
				incoming: SloganLine(text: "\u{201C}B\u{201D}", pose: .shown)
			)
		)
	}

	func testAFreshlyPublishedListDropsTheFinishedHandoff() {
		let rotation = makeRotation()
		rotation.publish(["A", "B"])
		rotation.advance(at: start.addingTimeInterval(5))
		XCTAssertEqual(rotation.current, "B")

		rotation.publish(["C", "D"])

		XCTAssertEqual(rotation.handoff, nil, "a stale handoff would keep rendering a slogan the new list no longer holds")
		XCTAssertEqual(
			rotation.subtitle(at: start.addingTimeInterval(6)).incoming.text, "\u{201C}C\u{201D}",
			"the screen shows the new list's first entry, not the previous list's incoming slogan"
		)
	}

	func testAPausedClockHoldsTheHandoffWhereTheStormStopped() {
		let rotation = makeRotation()
		rotation.publish(["A", "B"])
		rotation.clock = rotation.clock.pausing(at: start.addingTimeInterval(5))

		rotation.advance(at: start.addingTimeInterval(30))

		XCTAssertEqual(rotation.handoff?.startedAt, 5, "time the app spent in the background never plays back")
	}

	func testRunLoadsThePublishedListThenCyclesUntilCancelled() async throws {
		let rotation = makeRotation()

		let cycling = Task { await rotation.run(reduceMotion: false, load: { ["A", "B", "C"] }) }
		try await Task.sleep(nanoseconds: 80_000_000)
		cycling.cancel()
		await cycling.value

		XCTAssertEqual(rotation.slogans, ["A", "B", "C"])
		let handoff = try XCTUnwrap(rotation.handoff)
		XCTAssertEqual(handoff.incoming, rotation.current)
		XCTAssertGreaterThanOrEqual(handoff.ordinal, 1, "the rotation keeps advancing until its task is cancelled")
	}

	func testRunLeavesTheFirstSloganAloneUnderReducedMotion() async {
		let rotation = makeRotation()

		await rotation.run(reduceMotion: true, load: { ["A", "B", "C"] })

		XCTAssertEqual(rotation.current, "A")
		XCTAssertEqual(rotation.subtitle(at: start).incoming.text, "\u{201C}A\u{201D}")
		XCTAssertEqual(rotation.handoff, nil)
	}

	func testRunNeverCyclesASingleSlogan() async {
		let rotation = makeRotation()

		await rotation.run(reduceMotion: false, load: { [] })

		XCTAssertEqual(rotation.current, "Fallback.")
		XCTAssertEqual(rotation.handoff, nil)
	}
}
