package com.readplace.android.app

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.invisibleToUser
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import java.time.Instant

/**
 * Draws one zone of the login background's wave field: a ~30 fps loop over the
 * tested [CosmicWaveField] while the app is foregrounded, a single static frame
 * under Reduce Motion, and a [WaveClock] that pauses with the screen so the motion
 * resumes where it left off rather than jumping.
 */
@Composable
fun CosmicWavesCanvas(
	zone: CosmicZone,
	seed: ULong,
	reduceMotion: Boolean,
	paused: Boolean,
	modifier: Modifier = Modifier,
) {
	val field = remember(seed, zone) { CosmicWaveField(seed = seed, zone = zone) }
	val dark = isSystemInDarkTheme()
	val configuration = LocalConfiguration.current
	val density = LocalDensity.current
	val screen = remember(configuration, density) {
		WaveSize(
			width = with(density) { configuration.screenWidthDp.dp.toPx() }.toDouble(),
			height = with(density) { configuration.screenHeightDp.dp.toPx() }.toDouble(),
		)
	}
	var clock by remember { mutableStateOf(WaveClock(accumulated = 0.0, resumedAt = if (paused) null else Instant.now())) }
	var elapsed by remember { mutableDoubleStateOf(0.0) }

	LaunchedEffect(paused) {
		clock = if (paused) clock.pausing(Instant.now()) else clock.resuming(Instant.now())
	}
	if (!reduceMotion) {
		LaunchedEffect(paused, field) {
			if (paused) return@LaunchedEffect
			var last = 0L
			while (true) {
				withFrameNanos { now ->
					if (now - last >= FRAME_INTERVAL_NANOS) {
						last = now
						elapsed = clock.elapsed(Instant.now())
					}
				}
			}
		}
	}

	Canvas(
		modifier = modifier
			.fillMaxSize()
			.graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
			.semantics { invisibleToUser() },
	) {
		val frame = WaveRect(x = 0.0, y = 0.0, width = size.width.toDouble(), height = size.height.toDouble())
		val strokes = if (reduceMotion) {
			field.staticStrokes(zoneFrame = frame, screenSize = screen)
		} else {
			field.strokes(zoneFrame = frame, screenSize = screen, elapsed = elapsed)
		}
		for (stroke in strokes) drawFilament(stroke, dark)
		maskEdges(zone)
	}
}

private const val FRAME_INTERVAL_NANOS = 1_000_000_000L / 30

private fun DrawScope.drawFilament(stroke: FilamentStroke, dark: Boolean) {
	if (stroke.points.size < 2) return
	val path = Path().apply {
		moveTo(stroke.points[0].x.toFloat(), stroke.points[0].y.toFloat())
		for (point in stroke.points.drop(1)) lineTo(point.x.toFloat(), point.y.toFloat())
	}
	val hue = stroke.hue.resolved(dark)
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

