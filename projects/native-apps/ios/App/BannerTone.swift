import SwiftUI

enum BannerTone: Equatable {
	case offline
	case error
	case warning

	init(errorText: String) {
		self = errorText == OfflineReading.bannerText ? .offline : .error
	}

	var fill: Color {
		switch self {
		case .offline: return .brandSecondary
		case .error: return .brandErrorFill
		case .warning: return .brandSecondary
		}
	}

	var ink: Color {
		self == .error ? .white : .brandTextPrimary
	}

	var backdrop: Color {
		self == .error ? .clear : .brandSurface
	}
}
