import XCTest
@testable import Readplace

final class UploadJobTests: XCTestCase {
	private static let epoch = Date(timeIntervalSince1970: 1_000_000)

	private func pendingJob(attempts: Int = 0, nextAttemptAt: Date = UploadJobTests.epoch) -> UploadJob {
		UploadJob(
			id: "j1",
			url: "https://example.com/post",
			title: "A Title",
			state: .capturePending(detectedMediaType: nil),
			attempts: attempts,
			nextAttemptAt: nextAttemptAt,
			createdAt: UploadJobTests.epoch
		)
	}

	// MARK: - Backoff

	func testStepsThroughTheBackoffTableAndHoldsAtItsLastEntry() {
		var job = pendingJob()
		var delays: [TimeInterval] = []

		while let next = job.retried(now: UploadJobTests.epoch) {
			delays.append(next.nextAttemptAt.timeIntervalSince(UploadJobTests.epoch))
			job = next
		}

		XCTAssertEqual(delays, [60, 300, 900, 3600, 10800, 21600, 21600])
		XCTAssertEqual(job.attempts, 7)
	}

	func testStopsRetryingOnceTheAttemptBudgetIsSpent() {
		XCTAssertEqual(pendingJob(attempts: 6).retried(now: UploadJobTests.epoch)?.attempts, 7)
		XCTAssertNil(
			pendingJob(attempts: 7).retried(now: UploadJobTests.epoch),
			"eight attempts is the whole budget, after which the job is dropped rather than kept forever"
		)
	}

	func testCarriesTheRestOfTheJobAcrossARetry() throws {
		let retried = try XCTUnwrap(pendingJob().retried(now: UploadJobTests.epoch))

		XCTAssertEqual(retried.id, "j1")
		XCTAssertEqual(retried.url, "https://example.com/post")
		XCTAssertEqual(retried.title, "A Title")
		XCTAssertEqual(retried.createdAt, UploadJobTests.epoch)
	}

	// MARK: - Due time

	func testIsDueOnlyOnceItsScheduledInstantHasArrived() {
		let job = pendingJob(nextAttemptAt: UploadJobTests.epoch)

		XCTAssertFalse(job.isDue(now: UploadJobTests.epoch.addingTimeInterval(-1)))
		XCTAssertTrue(job.isDue(now: UploadJobTests.epoch))
		XCTAssertTrue(job.isDue(now: UploadJobTests.epoch.addingTimeInterval(1)))
	}

	// MARK: - Record

	func testRoundTripsEachStateThroughItsRecord() throws {
		let pending = pendingJob()
		let ready = pending.staged(contentType: "multipart/form-data; boundary=b")
		let detecting = pending.detecting(mediaType: "application/pdf")
		let encoder = JSONEncoder()
		let decoder = JSONDecoder()

		XCTAssertEqual(ready.state, .ready(contentType: "multipart/form-data; boundary=b"))
		XCTAssertEqual(detecting.state, .capturePending(detectedMediaType: "application/pdf"))
		XCTAssertEqual(try decoder.decode(UploadJob.self, from: try encoder.encode(pending)), pending)
		XCTAssertEqual(try decoder.decode(UploadJob.self, from: try encoder.encode(ready)), ready)
		XCTAssertEqual(try decoder.decode(UploadJob.self, from: try encoder.encode(detecting)), detecting)
	}

	func testDecodesAReadyRecordCarryingItsContentType() throws {
		let record = Data("""
		{
			"id": "j1", "url": "https://example.com/post", "title": "A Title",
			"state": { "kind": "ready", "contentType": "multipart/form-data; boundary=b" },
			"attempts": 0, "nextAttemptAt": 0, "createdAt": 0
		}
		""".utf8)

		let job = try JSONDecoder().decode(UploadJob.self, from: record)

		XCTAssertEqual(job.state, .ready(contentType: "multipart/form-data; boundary=b"))
	}

	func testRejectsAReadyRecordMissingItsContentType() {
		let record = Data("""
		{
			"id": "j1", "url": "https://example.com/post", "title": "A Title",
			"state": { "kind": "ready" },
			"attempts": 0, "nextAttemptAt": 0, "createdAt": 0
		}
		""".utf8)

		XCTAssertThrowsError(try JSONDecoder().decode(UploadJob.self, from: record)) { error in
			XCTAssertTrue(
				error is DecodingError,
				"a ready job whose body could never be found must fail its decode so the store drops it: \(error)"
			)
		}
	}
}
