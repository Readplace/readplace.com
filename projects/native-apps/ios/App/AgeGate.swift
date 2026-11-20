import Foundation

enum AgeRange: String, Equatable {
	case under13 = "under-13"
	case thirteenToFifteen = "13-15"
	case sixteenToSeventeen = "16-17"
	case eighteenPlus = "18-plus"

	init(lowerBound: Int?) {
		switch lowerBound ?? 0 {
		case 18...: self = .eighteenPlus
		case 16...: self = .sixteenToSeventeen
		case 13...: self = .thirteenToFifteen
		default: self = .under13
		}
	}
}

enum ParentalApproval: String, Equatable {
	case noneReported = "none-reported"
	case approved
	case pending
	case denied
	case revoked
}

enum AgeSignal: Equatable {
	case notApplicable
	case declined
	case known(AgeRange, ParentalApproval)
}

struct AgeSignalSource {
	let read: () async -> AgeSignal

	static let unavailable = AgeSignalSource { .notApplicable }
}

enum AgeRefusal: Equatable {
	case under13
	case parentalApprovalMissing

	init?(range: AgeRange, approval: ParentalApproval) {
		switch (range, approval) {
		case (.under13, _): self = .under13
		case (_, .pending), (_, .denied), (_, .revoked): self = .parentalApprovalMissing
		default: return nil
		}
	}

	var fallbackText: String {
		switch self {
		case .under13: return "Readplace is for people 13 and over."
		case .parentalApprovalMissing:
			return "A parent or guardian needs to approve Readplace in the app store before you can use it."
		}
	}
}

enum AgeRangeReport: Equatable {
	case allowed
	case refused(message: String?)
	case unknown
}

@MainActor
final class AgeGate: ObservableObject {
	enum Phase: Equatable {
		case checking
		case allowed
		case refused(AgeRefusal, serverText: String?)
	}

	private struct PendingReport {
		let range: AgeRange
		let approval: ParentalApproval
		let refusal: AgeRefusal
	}

	@Published private(set) var phase: Phase = .checking

	private let isSignedIn: () -> Bool
	private let report: (AgeRange, ParentalApproval) async -> AgeRangeReport
	private let signOut: () -> Void
	private var started = false
	private var pending: PendingReport?

	init(
		isSignedIn: @escaping () -> Bool,
		report: @escaping (AgeRange, ParentalApproval) async -> AgeRangeReport,
		signOut: @escaping () -> Void
	) {
		self.isSignedIn = isSignedIn
		self.report = report
		self.signOut = signOut
	}

	convenience init(session: AppSession) {
		self.init(
			isSignedIn: { session.isLoggedIn },
			report: { range, approval in await session.makeAPI().reportAgeRange(range: range, approval: approval) },
			signOut: { session.forceLogout() }
		)
	}

	var isChecking: Bool { phase == .checking }

	var refusalText: String? {
		guard case .refused(let refusal, let serverText) = phase else { return nil }
		return serverText ?? refusal.fallbackText
	}

	func settle(reading source: AgeSignalSource) async {
		guard !started else { return }
		started = true
		guard case .known(let range, let approval) = await source.read(),
			let refusal = AgeRefusal(range: range, approval: approval)
		else {
			phase = .allowed
			return
		}
		phase = .refused(refusal, serverText: nil)
		guard isSignedIn() else { return }
		pending = PendingReport(range: range, approval: approval, refusal: refusal)
		await reportRefusal()
	}

	func retryReport() async {
		await reportRefusal()
	}

	private func reportRefusal() async {
		guard let owed = pending else { return }
		pending = nil
		switch await report(owed.range, owed.approval) {
		case .refused(let message):
			phase = .refused(owed.refusal, serverText: message)
			signOut()
		case .allowed:
			return
		case .unknown:
			pending = owed
		}
	}
}

extension ReadplaceAPI {
	func reportAgeRange(range: AgeRange, approval: ParentalApproval) async -> AgeRangeReport {
		do {
			guard let action = try await discoverReadlist().action(named: "report-age-range") else { return .unknown }
			_ = try await invoke(action: action, values: ["ageRange": range.rawValue, "parentalApproval": approval.rawValue])
			return .allowed
		} catch APIError.refused(let messages) {
			return .refused(message: messages.first?.plainText)
		} catch {
			return .unknown
		}
	}
}
