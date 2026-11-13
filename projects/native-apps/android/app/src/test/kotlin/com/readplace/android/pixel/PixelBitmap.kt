package com.readplace.android.pixel

import java.awt.image.BufferedImage
import java.io.File
import javax.imageio.ImageIO

class PixelBitmap(val width: Int, val height: Int, val argb: IntArray) {
	init {
		require(argb.size == width * height) { "argb holds ${argb.size} pixels, not $width x $height" }
	}

	fun encodePng(file: File) {
		val image = BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB)
		image.setRGB(0, 0, width, height, argb, 0, width)
		file.parentFile.mkdirs()
		check(ImageIO.write(image, "png", file)) { "no PNG writer for $file" }
	}

	override fun equals(other: Any?): Boolean =
		other is PixelBitmap && width == other.width && height == other.height && argb.contentEquals(other.argb)

	override fun hashCode(): Int = 31 * (31 * width + height) + argb.contentHashCode()

	override fun toString(): String = "PixelBitmap(${width}x$height)"
}

fun decodePng(file: File): PixelBitmap {
	val image = checkNotNull(ImageIO.read(file)) { "not a PNG: $file" }
	val argb = image.getRGB(0, 0, image.width, image.height, null, 0, image.width)
	return PixelBitmap(width = image.width, height = image.height, argb = argb)
}
