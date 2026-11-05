import Foundation

func processNativeUserAgent(bundle: Bundle = .main, osVersion: OperatingSystemVersion = ProcessInfo.processInfo.operatingSystemVersion) -> String {
	guard let product = bundle.object(forInfoDictionaryKey: "CFBundleName") as? String, let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String else { preconditionFailure() }
	return AppConfig.nativeUserAgent(product: product, build: build, osVersion: osVersion)
}
