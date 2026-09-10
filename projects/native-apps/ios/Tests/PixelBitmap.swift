import CoreGraphics
import UIKit

struct PixelBitmap: Equatable {
	let width: Int
	let height: Int
	let rgba: [UInt8]

	var size: CGSize { CGSize(width: width, height: height) }

	init(width: Int, height: Int, rgba: [UInt8]) {
		self.width = width
		self.height = height
		self.rgba = rgba
	}

	init(redrawing image: CGImage) {
		let width = image.width
		let height = image.height
		var rgba = [UInt8](repeating: 0, count: width * height * 4)
		rgba.withUnsafeMutableBytes { buffer in
			let context = CGContext(
				data: buffer.baseAddress,
				width: width,
				height: height,
				bitsPerComponent: 8,
				bytesPerRow: width * 4,
				space: CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB(),
				bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
			)
			context?.setFillColor(UIColor.black.cgColor)
			context?.fill(CGRect(x: 0, y: 0, width: width, height: height))
			context?.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
		}
		self.init(width: width, height: height, rgba: rgba)
	}

	init?(pngData: Data) {
		guard let image = UIImage(data: pngData)?.cgImage else { return nil }
		self.init(redrawing: image)
	}

	func pngData() -> Data? {
		var pixels = rgba
		let image = pixels.withUnsafeMutableBytes { buffer -> CGImage? in
			let context = CGContext(
				data: buffer.baseAddress,
				width: width,
				height: height,
				bitsPerComponent: 8,
				bytesPerRow: width * 4,
				space: CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB(),
				bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
			)
			return context?.makeImage()
		}
		return image.flatMap { UIImage(cgImage: $0).pngData() }
	}
}
