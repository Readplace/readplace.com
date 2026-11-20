import XCTest
@testable import Readplace

@MainActor
final class AgeGateTests: XCTestCase {
	private final class Recorder {
		var reads = 0
		var reports: [(AgeRange, ParentalApproval)] = []
		var signOuts = 0
		var answers: [AgeRangeReport] = []
	}

	private let recorder = Recorder()

	override func setUp() {
		super.setUp()
		StubURLProtocol.reset()
	}

	// MARK: - Mapping

	func testALowerBoundMapsToTheGateItClears() {
		let table: [(Int?, AgeRange)] = [
			(nil, .under13), (0, .under13), (12, .under13),
			(13, .thirteenToFifteen), (15, .thirteenToFifteen),
			(16, .sixteenToSeventeen), (17, .sixteenToSeventeen),
			(18, .eighteenPlus), (40, .eighteenPlus),
		]
		for (lowerBound, expected) in table {
			XCTAssertEqual(AgeRange(lowerBound: lowerBound), expected, "lower bound \(String(describing: lowerBound))")
		}
	}

	func testTheRefusalMirrorsTheServerDecision() {
		XCTAssertEqual(AgeRefusal(range: .under13, approval: .approved), .under13)
		XCTAssertEqual(AgeRefusal(range: .under13, approval: .noneReported), .under13)
		for approval in [ParentalApproval.pending, .denied, .revoked] {
			XCTAssertEqual(AgeRefusal(range: .thirteenToFifteen, approval: approval), .parentalApprovalMissing)
			XCTAssertEqual(AgeRefusal(range: .eighteenPlus, approval: approval), .parentalApprovalMissing)
		}
		XCTAssertNil(AgeRefusal(range: .sixteenToSeventeen, approval: .approved))
		XCTAssertNil(AgeRefusal(range: .eighteenPlus, approval: .noneReported))
	}

	func testTheWireValuesMatchTheServerContract() {
		XCTAssertEqual(
			[AgeRange.under13, .thirteenToFifteen, .sixteenToSeventeen, .eighteenPlus].map(\.rawValue),
			["under-13", "13-15", "16-17", "18-plus"]
		)
		XCTAssertEqual(
			[ParentalApproval.noneReported, .approved, .pending, .denied, .revoked].map(\.rawValue),
			["none-reported", "approved", "pending", "denied", "revoked"]
		)
	}

	// MARK: - Gate

	func testTheGateHoldsSignInUntilTheSignalSettles() async {
		let gate = makeGate(signedIn: false)
		XCTAssertTrue(gate.isChecking)

		await gate.settle(reading: .unavailable)

		XCTAssertEqual(gate.phase, .allowed)
		XCTAssertFalse(gate.isChecking)
		XCTAssertNil(gate.refusalText)
	}

	func testNoSignalADeclineOrAnAllowedAgeContinues() async {
		for signal in [AgeSignal.notApplicable, .declined, .known(.thirteenToFifteen, .approved), .known(.eighteenPlus, .noneReported)] {
			let gate = makeGate(signedIn: true)
			await gate.settle(reading: source(signal))
			XCTAssertEqual(gate.phase, .allowed, "\(signal)")
		}
		XCTAssertTrue(recorder.reports.isEmpty, "an allowed decision is never reported")
		XCTAssertEqual(recorder.signOuts, 0)
	}

	func testTheSignalIsReadOncePerLaunch() async {
		let gate = makeGate(signedIn: false)
		await gate.settle(reading: source(.declined))
		await gate.settle(reading: source(.known(.under13, .noneReported)))

		XCTAssertEqual(recorder.reads, 1)
		XCTAssertEqual(gate.phase, .allowed)
	}

	func testASignedOutMinorIsRefusedWithoutReporting() async {
		let gate = makeGate(signedIn: false)
		await gate.settle(reading: source(.known(.under13, .noneReported)))

		XCTAssertEqual(gate.phase, .refused(.under13, serverText: nil))
		XCTAssertEqual(gate.refusalText, "Readplace is for people 13 and over.")
		XCTAssertTrue(recorder.reports.isEmpty)
		XCTAssertEqual(recorder.signOuts, 0)
	}

	func testAMissingApprovalShowsTheApprovalRefusal() async {
		let gate = makeGate(signedIn: false)
		await gate.settle(reading: source(.known(.sixteenToSeventeen, .denied)))

		XCTAssertEqual(
			gate.refusalText,
			"A parent or guardian needs to approve Readplace in the app store before you can use it."
		)
	}

	func testASignedInRefusalIsReportedAndSignsTheDeviceOutWithTheServersWords() async {
		recorder.answers = [.refused(message: "Server says no.")]
		let gate = makeGate(signedIn: true)

		await gate.settle(reading: source(.known(.thirteenToFifteen, .revoked)))

		XCTAssertEqual(recorder.reports.map(\.0), [.thirteenToFifteen])
		XCTAssertEqual(recorder.reports.map(\.1), [.revoked])
		XCTAssertEqual(recorder.signOuts, 1)
		XCTAssertEqual(gate.refusalText, "Server says no.")
	}

	func testARefusalWithoutServerWordsKeepsTheLocalText() async {
		recorder.answers = [.refused(message: nil)]
		let gate = makeGate(signedIn: true)

		await gate.settle(reading: source(.known(.under13, .noneReported)))

		XCTAssertEqual(recorder.signOuts, 1)
		XCTAssertEqual(gate.refusalText, "Readplace is for people 13 and over.")
	}

	func testAnUnknownAnswerKeepsTheRefusalAndCredentialsAndRetriesOnForeground() async {
		recorder.answers = [.unknown, .refused(message: nil)]
		let gate = makeGate(signedIn: true)

		await gate.settle(reading: source(.known(.under13, .noneReported)))
		XCTAssertEqual(recorder.signOuts, 0, "credentials stay until the server has acted")
		XCTAssertEqual(gate.phase, .refused(.under13, serverText: nil))

		await gate.retryReport()
		XCTAssertEqual(recorder.reports.count, 2)
		XCTAssertEqual(recorder.signOuts, 1)

		await gate.retryReport()
		XCTAssertEqual(recorder.reports.count, 2, "a settled report is not sent again")
	}

	func testAnAllowedAnswerKeepsTheLocalRefusalAndStopsReporting() async {
		recorder.answers = [.allowed]
		let gate = makeGate(signedIn: true)

		await gate.settle(reading: source(.known(.under13, .noneReported)))
		await gate.retryReport()

		XCTAssertEqual(recorder.reports.count, 1)
		XCTAssertEqual(recorder.signOuts, 0)
		XCTAssertEqual(gate.phase, .refused(.under13, serverText: nil))
	}

	func testARetryWithNothingOwedSendsNothing() async {
		let gate = makeGate(signedIn: true)
		await gate.retryReport()
		XCTAssertTrue(recorder.reports.isEmpty)
	}

	// MARK: - Session wiring

	func testTheSessionGateReportsThroughTheAPIAndForceLogsOut() async {
		StubURLProtocol.setHandler { request, _ in
			if request.url?.path == "/" { return .json(200, Fixtures.collection(entitiesJSON: [], actionsJSON: Self.reportAction)) }
			return .json(403, Fixtures.messageRefusal([("warning", "text/html", "<p>Locked by the server.</p>")]))
		}
		let session = AppSession(store: TestSupport.loggedInStore(), nativeUserAgent: TestSupport.nativeUserAgent,
			sessionConfiguration: TestSupport.stubbedConfiguration(), readStorefront: { nil }, wipeReaderWebStore: {},
			purgeShareArtifacts: {}, forgetReaderChoices: {}, forgetOfflineCopies: {})
		let gate = AgeGate(session: session)

		await gate.settle(reading: source(.known(.under13, .noneReported)))

		XCTAssertFalse(session.isLoggedIn)
		XCTAssertEqual(gate.refusalText, "Locked by the server.")
	}

	// MARK: - API

	func testTheReportPostsTheDeclaredFieldsToTheAdvertisedAction() async throws {
		StubURLProtocol.setHandler { request, _ in
			request.url?.path == "/"
				? .json(200, Fixtures.collection(entitiesJSON: [], actionsJSON: Self.reportAction))
				: StubURLProtocol.Stub(status: 204)
		}

		let report = await makeAPI().reportAgeRange(range: .sixteenToSeventeen, approval: .pending)

		XCTAssertEqual(report, .allowed)
		let post = try XCTUnwrap(StubURLProtocol.records(path: "/queue/age-range").first)
		XCTAssertEqual(post.request.httpMethod, "POST")
		XCTAssertEqual(TestSupport.formFields(post.body), ["ageRange": "16-17", "parentalApproval": "pending"])
	}

	func testARefusalCarriesTheServersMessage() async {
		StubURLProtocol.setHandler { request, _ in
			request.url?.path == "/"
				? .json(200, Fixtures.collection(entitiesJSON: [], actionsJSON: Self.reportAction))
				: .json(403, Fixtures.messageRefusal([("warning", "text/html", "Ask a parent.")]))
		}

		let report = await makeAPI().reportAgeRange(range: .thirteenToFifteen, approval: .denied)

		XCTAssertEqual(report, .refused(message: "Ask a parent."))
	}

	func testARefusalWithoutMessagesHasNoServerWords() async {
		StubURLProtocol.setHandler { request, _ in
			request.url?.path == "/"
				? .json(200, Fixtures.collection(entitiesJSON: [], actionsJSON: Self.reportAction))
				: .json(403, Fixtures.messageRefusal([]))
		}

		let report = await makeAPI().reportAgeRange(range: .under13, approval: .noneReported)

		XCTAssertEqual(report, .refused(message: nil))
	}

	func testAServerThatDoesNotAdvertiseTheActionIsUnknown() async {
		StubURLProtocol.setHandler { _, _ in .json(200, Fixtures.collection(entitiesJSON: [])) }

		let report = await makeAPI().reportAgeRange(range: .under13, approval: .noneReported)

		XCTAssertEqual(report, .unknown)
		XCTAssertTrue(StubURLProtocol.records(path: "/queue/age-range").isEmpty)
	}

	func testAServerErrorIsUnknown() async {
		StubURLProtocol.setHandler { request, _ in
			request.url?.path == "/"
				? .json(200, Fixtures.collection(entitiesJSON: [], actionsJSON: Self.reportAction))
				: .json(500, "{}")
		}

		let report = await makeAPI().reportAgeRange(range: .under13, approval: .noneReported)

		XCTAssertEqual(report, .unknown)
	}

	// MARK: - Helpers

	private static let reportAction = """
		{ "name": "report-age-range", "href": "/queue/age-range", "method": "POST", "type": "application/x-www-form-urlencoded", "fields": [{ "name": "ageRange", "type": "text" }, { "name": "parentalApproval", "type": "text" }] }
		"""

	private func makeAPI() -> ReadplaceAPI {
		ReadplaceAPI(
			baseURL: AppConfig.serverBaseURL, store: TestSupport.loggedInStore(), nativeUserAgent: TestSupport.nativeUserAgent,
			sessionConfiguration: TestSupport.stubbedConfiguration()
		)
	}

	private func source(_ signal: AgeSignal) -> AgeSignalSource {
		let recorder = recorder
		return AgeSignalSource {
			recorder.reads += 1
			return signal
		}
	}

	private func makeGate(signedIn: Bool) -> AgeGate {
		let recorder = recorder
		return AgeGate(
			isSignedIn: { signedIn },
			report: { range, approval in
				recorder.reports.append((range, approval))
				return recorder.answers.isEmpty ? .unknown : recorder.answers.removeFirst()
			},
			signOut: { recorder.signOuts += 1 }
		)
	}
}
