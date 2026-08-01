import XCTest
@testable import Readplace

final class UploadSessionDelegateTests: XCTestCase {
	private let session = URLSession(configuration: .ephemeral)

	private func makeTask(named name: String?) throws -> URLSessionTask {
		let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
		try Data("body".utf8).write(to: file)
		let task = session.uploadTask(with: URLRequest(url: URL(string: "https://example.com/queue/save-content")!), fromFile: file)
		task.taskDescription = name
		return task
	}

	func testReleasesTheStagedBodyWhenTheUploadFinishes() async throws {
		let staging = UploadStaging(containerURL: TestSupport.temporaryContainer())
		let staged = try await staging.stage(TestSupport.multipartForm())
		let delegate = UploadSessionDelegate(staging: staging, whenDrained: nil)

		delegate.urlSession(session, task: try makeTask(named: staged.lastPathComponent), didCompleteWithError: nil)

		XCTAssertFalse(FileManager.default.fileExists(atPath: staged.path))
	}

	func testReleasesTheStagedBodyWhenTheUploadFails() async throws {
		// A terminal failure shows the user nothing — the article is saved and the
		// crawl produced content — so the only work left is letting the body go.
		let staging = UploadStaging(containerURL: TestSupport.temporaryContainer())
		let staged = try await staging.stage(TestSupport.multipartForm())
		let delegate = UploadSessionDelegate(staging: staging, whenDrained: nil)

		delegate.urlSession(session, task: try makeTask(named: staged.lastPathComponent), didCompleteWithError: URLError(.timedOut))

		XCTAssertFalse(FileManager.default.fileExists(atPath: staged.path))
	}

	func testReleasesTheStagedBodyWhenTheServerRejectsTheUpload() async throws {
		// The failure URLSession calls a success: a refused upload completes with no
		// error at all, so the body has to be released off the response's status too —
		// and the refusal has to be logged, or a whole class of dead uploads is silent.
		StubURLProtocol.reset()
		StubURLProtocol.setHandler { _, _ in .json(406, "Not Acceptable") }
		let staging = UploadStaging(containerURL: TestSupport.temporaryContainer())
		let staged = try await staging.stage(TestSupport.multipartForm())
		let delegate = UploadSessionDelegate(staging: staging, whenDrained: nil)
		let rejecting = URLSession(configuration: TestSupport.stubbedConfiguration(), delegate: delegate, delegateQueue: nil)
		defer { rejecting.finishTasksAndInvalidate() }
		let task = rejecting.uploadTask(with: URLRequest(url: URL(string: "https://example.com/queue/save-content")!), fromFile: staged)
		task.taskDescription = staged.lastPathComponent

		task.resume()

		let released = expectation(description: "the staged body is released")
		let poll = Task {
			while FileManager.default.fileExists(atPath: staged.path), !Task.isCancelled {
				try? await Task.sleep(nanoseconds: 10_000_000)
			}
			released.fulfill()
		}
		await fulfillment(of: [released], timeout: 5)
		poll.cancel()
		XCTAssertEqual(
			UploadSessionDelegate.failure(error: nil, response: task.response), "the server refused it with 406",
			"the same completion the body was released on is the one that must reach the log"
		)
	}

	func testReportsNothingForAnUploadTheServerAccepted() throws {
		let accepted = try XCTUnwrap(HTTPURLResponse(
			url: URL(string: "https://example.com/queue/save-content")!,
			statusCode: 201,
			httpVersion: "HTTP/1.1",
			headerFields: nil
		))

		XCTAssertNil(UploadSessionDelegate.failure(error: nil, response: accepted))
	}

	func testReportsTheTransportFailureWhenThereIsOne() {
		XCTAssertEqual(
			UploadSessionDelegate.failure(error: URLError(.timedOut), response: nil),
			URLError(.timedOut).localizedDescription
		)
	}

	func testLeavesEveryBodyAloneWhenTheTaskNamesNone() async throws {
		let staging = UploadStaging(containerURL: TestSupport.temporaryContainer())
		let staged = try await staging.stage(TestSupport.multipartForm())
		let delegate = UploadSessionDelegate(staging: staging, whenDrained: nil)

		delegate.urlSession(session, task: try makeTask(named: nil), didCompleteWithError: nil)

		XCTAssertTrue(FileManager.default.fileExists(atPath: staged.path))
	}

	func testKeepsTheClientHeadersAcrossARedirect() throws {
		let staging = UploadStaging(containerURL: TestSupport.temporaryContainer())
		let delegate = UploadSessionDelegate(staging: staging, whenDrained: nil)
		var original = URLRequest(url: URL(string: "https://example.com/queue/save-content")!)
		original.setValue("Bearer access-1", forHTTPHeaderField: "Authorization")
		original.setValue("background", forHTTPHeaderField: AppConfig.saveContinuityHeader)
		let task = session.uploadTask(with: original, from: Data())
		let response = try XCTUnwrap(HTTPURLResponse(
			url: URL(string: "https://example.com/queue/save-content")!,
			statusCode: 307,
			httpVersion: "HTTP/1.1",
			headerFields: nil
		))
		var followed: URLRequest?

		delegate.urlSession(
			session,
			task: task,
			willPerformHTTPRedirection: response,
			newRequest: URLRequest(url: URL(string: "https://example.com/queue/save-content/2")!),
			completionHandler: { followed = $0 }
		)

		XCTAssertEqual(followed?.url?.path, "/queue/save-content/2")
		XCTAssertEqual(followed?.value(forHTTPHeaderField: "Authorization"), "Bearer access-1")
		XCTAssertEqual(followed?.value(forHTTPHeaderField: AppConfig.saveContinuityHeader), "background")
	}

	func testDrainsTheSystemHandlerOnceTheSessionsEventsAreDelivered() {
		let staging = UploadStaging(containerURL: TestSupport.temporaryContainer())
		var drained = 0
		let delegate = UploadSessionDelegate(staging: staging, whenDrained: { drained += 1 })

		delegate.urlSessionDidFinishEvents(forBackgroundURLSession: session)

		XCTAssertEqual(drained, 1, "the system is waiting on exactly one call")
	}

	func testTheExtensionsDelegateHasNoHandlerToDrain() {
		// The system relaunches the app, never the extension, so the extension's
		// delegate is given nothing to call back.
		let staging = UploadStaging(containerURL: TestSupport.temporaryContainer())
		let delegate = UploadSessionDelegate(staging: staging, whenDrained: nil)

		delegate.urlSessionDidFinishEvents(forBackgroundURLSession: session)
	}
}
