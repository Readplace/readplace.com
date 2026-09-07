import XCTest
@testable import Readplace

@MainActor
private final class SheetEvents {
	private(set) var recorded: [String] = []

	func record(_ event: String) {
		recorded.append(event)
	}
}

@MainActor
final class ShareSheetHoldTests: XCTestCase {
	func testKeepsTheOutcomeOnScreenAfterTheJourneySettles() async {
		let events = SheetEvents()
		let hold = ShareSheetHold(holdSeconds: 0.3)
		let settled = Task { @MainActor in events.record("settled") }
		let midHold = Task { @MainActor in
			do { try await Task.sleep(nanoseconds: 200_000_000) } catch { return }
			events.record("0.2s on from the outcome")
		}

		await hold.untilSettledAndRead(settled)
		events.record("sheet closed")
		midHold.cancel()

		XCTAssertEqual(
			events.recorded, ["settled", "0.2s on from the outcome", "sheet closed"],
			"the card holds the painted outcome after the journey settles rather than closing the moment the save lands"
		)
	}

	func testATapOutsideEndsALongHoldAtOnce() async {
		let events = SheetEvents()
		let hold = ShareSheetHold(holdSeconds: 30)
		let settled = Task<Void, Never> {}
		let satOutTheHold = Task { @MainActor in
			do { try await Task.sleep(nanoseconds: 1_000_000_000) } catch { return }
			events.record("sat out the hold")
		}
		let tap = Task { @MainActor in
			do { try await Task.sleep(nanoseconds: 50_000_000) } catch { return }
			hold.end()
		}

		await hold.untilSettledAndRead(settled)
		events.record("sheet closed")
		satOutTheHold.cancel()
		await tap.value

		XCTAssertEqual(
			events.recorded, ["sheet closed"],
			"a tap outside the card closes the sheet at once rather than sitting out the rest of the 30 s hold"
		)
	}

	func testASettleThatLandsAfterATapDoesNotCloseTheSheetASecondTime() async {
		let events = SheetEvents()
		let hold = ShareSheetHold(holdSeconds: 0.05)
		let settled = Task { @MainActor in
			try? await Task.sleep(nanoseconds: 300_000_000)
			events.record("settled")
		}
		let tap = Task { @MainActor in
			do { try await Task.sleep(nanoseconds: 50_000_000) } catch { return }
			hold.end()
		}

		await hold.untilSettledAndRead(settled)
		events.record("sheet closed")
		await tap.value
		await settled.value
		try? await Task.sleep(nanoseconds: 200_000_000)

		XCTAssertEqual(
			events.recorded, ["sheet closed", "settled"],
			"resuming the same continuation twice traps, so a journey that settles after the tap must find the claim already taken"
		)
	}
}
