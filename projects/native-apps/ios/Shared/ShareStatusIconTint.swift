import UIKit

extension ShareStatusTone {
	var iconTint: UIColor {
		switch self {
		case .success: return .brandSuccess
		case .warning: return .brandWarningText
		case .error: return .brandError
		}
	}
}
