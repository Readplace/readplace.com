package com.readplace.android.app

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.invisibleToUser
import androidx.compose.ui.semantics.semantics

/**
 * Draws one zone of the login background's wave field into its real, caller-measured
 * rectangle. The timeline is owned above (one storm clock and one frame loop for
 * both zones and the comet), so this host only paints: the tested [CosmicWaveField]
 * at [elapsed] with any [visits] a star has left in it, or a single static frame
 * under Reduce Motion. It draws nothing until the caller has measured its bounds.
 */
@Composable
fun CosmicWavesCanvas(
	zone: CosmicZone,
	seed: ULong,
	zoneFrame: WaveRect?,
	screenSize: WaveSize?,
	elapsed: Double,
	visits: List<StarVisit>,
	reduceMotion: Boolean,
	modifier: Modifier = Modifier,
) {
	val field = remember(seed, zone) { CosmicWaveField(seed = seed, zone = zone) }
	val dark = isSystemInDarkTheme()

	Canvas(
		modifier = modifier
			.fillMaxSize()
			.graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
			.semantics { invisibleToUser() },
	) {
		if (zoneFrame == null || screenSize == null) return@Canvas
		val strokes = if (reduceMotion) {
			field.staticStrokes(zoneFrame = zoneFrame, screenSize = screenSize)
		} else {
			field.strokes(zoneFrame = zoneFrame, screenSize = screenSize, elapsed = elapsed, visits = visits)
		}
		for (stroke in strokes) drawFilament(stroke, dark)
		maskEdges(zone)
	}
}

/**
 * The comet layer: the shooting star that carries one slogan into the next, drawn
 * across the whole screen behind the sign-in content. Purely decorative and
 * input-transparent, so it never intercepts a Login, Sign up, mute, or replay tap.
 * [comet] is composed above from the measured landmarks (idle under Reduce Motion),
 * and its coordinates are in the window space [cometOrigin] translates into.
 */
@Composable
fun SloganCometsCanvas(
	comet: SloganComet,
	cometOrigin: WavePoint?,
	modifier: Modifier = Modifier,
) {
	val dark = isSystemInDarkTheme()
	Canvas(
		modifier = modifier
			.fillMaxSize()
			.semantics { invisibleToUser() },
	) {
		val origin = cometOrigin ?: return@Canvas
		translate(left = -origin.x.toFloat(), top = -origin.y.toFloat()) {
			for (stroke in comet.strokes) drawFilament(stroke, dark)
			comet.head?.let { drawStarHead(it, dark) }
		}
	}
}

private fun DrawScope.drawFilament(stroke: FilamentStroke, dark: Boolean) {
	if (stroke.points.size < 2) return
	val path = Path().apply {
		moveTo(stroke.points[0].x.toFloat(), stroke.points[0].y.toFloat())
		for (point in stroke.points.drop(1)) lineTo(point.x.toFloat(), point.y.toFloat())
	}
	// A star burns as the hue itself; a veil stroke wears the hue's translucent variant.
	val hue = if (stroke.tone == StrokeTone.STAR) stroke.hue.star(dark) else stroke.hue.resolved(dark)
	val colour = Color(hue.red, hue.green, hue.blue).copy(alpha = (hue.alpha * stroke.opacity).toFloat())
	// Compose's canvas has no per-stroke blur filter; a wider, fainter pass under the
	// stroke reads the same as the iOS blur at these radii.
	if (stroke.blurRadius > 0) {
		drawPath(
			path = path,
			color = colour.copy(alpha = colour.alpha * 0.35f),
			style = Stroke(width = (stroke.lineWidth + stroke.blurRadius * 2).toFloat(), cap = StrokeCap.Butt, join = StrokeJoin.Round),
		)
	}
	drawPath(
		path = path,
		color = colour,
		style = Stroke(width = stroke.lineWidth.toFloat(), cap = StrokeCap.Butt, join = StrokeJoin.Round),
	)
}

/** The comet's head: a solid core inside a soft radial glow, both in the star's hue. */
private fun DrawScope.drawStarHead(head: StarHead, dark: Boolean) {
	val hue = head.hue.star(dark)
	val colour = Color(hue.red, hue.green, hue.blue)
	val center = Offset(head.center.x.toFloat(), head.center.y.toFloat())
	if (head.glowRadius > 0) {
		drawCircle(
			brush = Brush.radialGradient(
				colors = listOf(colour.copy(alpha = (head.opacity * 0.7).toFloat()), colour.copy(alpha = 0f)),
				center = center,
				radius = head.glowRadius.toFloat(),
			),
			radius = head.glowRadius.toFloat(),
			center = center,
		)
	}
	drawCircle(
		color = colour.copy(alpha = head.opacity.toFloat()),
		radius = head.coreRadius.toFloat(),
		center = center,
	)
}

/** The two edge fades, applied as destination-in gradients over the offscreen layer
 * so the field dissolves at the zone's edges exactly as the iOS masks do. */
private fun DrawScope.maskEdges(zone: CosmicZone) {
	fun stops(fade: EdgeFade) = arrayOf(
		0f to Color.Transparent,
		fade.leadIn.toFloat() to Color.Black,
		(1 - fade.leadOut).toFloat() to Color.Black,
		1f to Color.Transparent,
	)
	drawRect(
		brush = Brush.horizontalGradient(*stops(zone.horizontalFade), startX = 0f, endX = size.width),
		blendMode = BlendMode.DstIn,
	)
	drawRect(
		brush = Brush.verticalGradient(*stops(zone.verticalFade), startY = 0f, endY = size.height),
		blendMode = BlendMode.DstIn,
	)
}
