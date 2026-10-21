package lat.devdj.codex.watch

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.cos
import kotlin.math.sin

/** Line icons drawn on a 24-unit grid: one weight, round caps, no font or bitmap assets. */
enum class Glyph {
    Mic, Keyboard, Send, Speaker, Folder, Bell, Sliders, Check, Alert, Clock, Close, Back, Chevron, Refresh, Plus,
    Sparkle, Code, Terminal, Shield, Server, Chat, List, Lines, File, Branch, Upload, Box, Eye, More, Trash, Stop,
    Edit, Power, Star, Home, Gauge,
}

@Composable fun GlyphIcon(glyph: Glyph, tint: Color, modifier: Modifier = Modifier, size: Dp = 20.dp) {
    Canvas(modifier.size(size)) { drawGlyph(glyph, tint) }
}

private val Line = Stroke(width = 1.9f, cap = StrokeCap.Round, join = StrokeJoin.Round)

internal fun DrawScope.drawGlyph(glyph: Glyph, color: Color) {
    val unit = size.minDimension / 24f
    withTransform({ scale(unit, unit, Offset.Zero) }) {
        fun path(build: Path.() -> Unit) = drawPath(Path().apply(build), color, style = Line)
        fun line(x1: Float, y1: Float, x2: Float, y2: Float) = drawLine(color, Offset(x1, y1), Offset(x2, y2), 1.9f, StrokeCap.Round)
        fun ring(x: Float, y: Float, r: Float) = drawCircle(color, r, Offset(x, y), style = Line)
        fun dot(x: Float, y: Float, r: Float = 1.4f) = drawCircle(color, r, Offset(x, y))
        fun box(x: Float, y: Float, w: Float, h: Float, r: Float) = drawRoundRect(color, Offset(x, y), Size(w, h), CornerRadius(r), style = Line)
        fun arc(x: Float, y: Float, d: Float, from: Float, sweep: Float) = drawArc(color, from, sweep, false, Offset(x, y), Size(d, d), style = Line)
        when (glyph) {
            Glyph.Mic -> { box(9f, 3f, 6f, 11f, 3f); arc(5.5f, 5.5f, 13f, 0f, 180f); line(12f, 18.5f, 12f, 21f); line(9f, 21f, 15f, 21f) }
            Glyph.Keyboard -> { box(2.5f, 6f, 19f, 12f, 3f); dot(7f, 10f); dot(12f, 10f); dot(17f, 10f); line(8f, 14.2f, 16f, 14.2f) }
            Glyph.Send -> path { moveTo(3f, 11.5f); lineTo(21f, 3.5f); lineTo(14f, 20.5f); lineTo(11.3f, 13.2f); close(); moveTo(11.3f, 13.2f); lineTo(21f, 3.5f) }
            Glyph.Speaker -> {
                path { moveTo(4f, 9.5f); lineTo(8f, 9.5f); lineTo(13f, 5.5f); lineTo(13f, 18.5f); lineTo(8f, 14.5f); lineTo(4f, 14.5f); close() }
                arc(10.5f, 8.5f, 7f, -50f, 100f); arc(8f, 5.5f, 13f, -50f, 100f)
            }
            Glyph.Folder -> path {
                moveTo(3f, 7.5f); quadraticTo(3f, 5.5f, 5f, 5.5f); lineTo(9.5f, 5.5f); lineTo(12f, 8f); lineTo(19f, 8f)
                quadraticTo(21f, 8f, 21f, 10f); lineTo(21f, 17.5f); quadraticTo(21f, 19.5f, 19f, 19.5f); lineTo(5f, 19.5f)
                quadraticTo(3f, 19.5f, 3f, 17.5f); close()
            }
            Glyph.Bell -> {
                path { moveTo(6f, 17.5f); lineTo(6f, 11f); arcTo(Rect(6f, 5f, 18f, 17f), 180f, 180f, false); lineTo(18f, 17.5f); lineTo(20f, 19f); lineTo(4f, 19f); close() }
                line(12f, 2.8f, 12f, 5f); path { moveTo(10f, 21.2f); quadraticTo(12f, 23.2f, 14f, 21.2f) }
            }
            Glyph.Sliders -> {
                line(4f, 6f, 6.2f, 6f); line(11.8f, 6f, 20f, 6f); ring(9f, 6f, 2.8f)
                line(4f, 12f, 12.2f, 12f); line(17.8f, 12f, 20f, 12f); ring(15f, 12f, 2.8f)
                line(4f, 18f, 5.2f, 18f); line(10.8f, 18f, 20f, 18f); ring(8f, 18f, 2.8f)
            }
            Glyph.Check -> path { moveTo(5f, 12.5f); lineTo(10f, 17.5f); lineTo(19f, 7f) }
            Glyph.Alert -> { path { moveTo(12f, 3.5f); lineTo(21.5f, 20f); lineTo(2.5f, 20f); close() }; line(12f, 10f, 12f, 14.2f); dot(12f, 17f) }
            Glyph.Clock -> { ring(12f, 12f, 9f); path { moveTo(12f, 7f); lineTo(12f, 12f); lineTo(15.5f, 14f) } }
            Glyph.Close -> { line(6f, 6f, 18f, 18f); line(18f, 6f, 6f, 18f) }
            Glyph.Back -> path { moveTo(19f, 12f); lineTo(5f, 12f); moveTo(11f, 5.5f); lineTo(4.5f, 12f); lineTo(11f, 18.5f) }
            Glyph.Chevron -> path { moveTo(9f, 5f); lineTo(16f, 12f); lineTo(9f, 19f) }
            Glyph.Refresh -> { arc(4f, 4f, 16f, 40f, 280f); path { moveTo(19f, 2.8f); lineTo(19f, 7.5f); lineTo(14.3f, 7.5f) } }
            Glyph.Plus -> { line(12f, 5f, 12f, 19f); line(5f, 12f, 19f, 12f) }
            Glyph.Sparkle -> for (i in 0 until 8) {
                val angle = Math.toRadians(i * 45.0 - 90.0); val tip = if (i % 2 == 0) 10f else 7.2f
                line(12f + cos(angle).toFloat() * 3.4f, 12f + sin(angle).toFloat() * 3.4f, 12f + cos(angle).toFloat() * tip, 12f + sin(angle).toFloat() * tip)
            }
            Glyph.Code -> path { moveTo(8.5f, 7f); lineTo(3.5f, 12f); lineTo(8.5f, 17f); moveTo(15.5f, 7f); lineTo(20.5f, 12f); lineTo(15.5f, 17f); moveTo(13.6f, 5.5f); lineTo(10.4f, 18.5f) }
            Glyph.Terminal -> { box(2.5f, 4.5f, 19f, 15f, 3.5f); path { moveTo(7f, 9.5f); lineTo(10.5f, 12.5f); lineTo(7f, 15.5f) }; line(12.5f, 15.5f, 17f, 15.5f) }
            Glyph.Shield -> { path { moveTo(12f, 3f); lineTo(19.5f, 6f); lineTo(19.5f, 12f); quadraticTo(19.5f, 18f, 12f, 21f); quadraticTo(4.5f, 18f, 4.5f, 12f); lineTo(4.5f, 6f); close() }
                path { moveTo(8.6f, 12f); lineTo(11f, 14.4f); lineTo(15.6f, 9.6f) } }
            Glyph.Server -> { box(4f, 4.5f, 16f, 6.5f, 2f); box(4f, 13f, 16f, 6.5f, 2f); dot(7.8f, 7.75f); dot(7.8f, 16.25f) }
            Glyph.Chat -> { box(3.5f, 4.5f, 17f, 12.5f, 4f); path { moveTo(8.5f, 17f); lineTo(8.5f, 21f); lineTo(13f, 17f) } }
            Glyph.List -> { line(9f, 7f, 20f, 7f); line(9f, 12f, 20f, 12f); line(9f, 17f, 20f, 17f); dot(4.8f, 7f); dot(4.8f, 12f); dot(4.8f, 17f) }
            Glyph.Lines -> { line(4f, 7f, 20f, 7f); line(4f, 12f, 15f, 12f); line(4f, 17f, 18f, 17f) }
            Glyph.File -> { path { moveTo(6f, 3.5f); lineTo(14f, 3.5f); lineTo(19f, 8.5f); lineTo(19f, 20.5f); lineTo(6f, 20.5f); close() }; path { moveTo(14f, 3.5f); lineTo(14f, 8.5f); lineTo(19f, 8.5f) } }
            Glyph.Branch -> { ring(7f, 5.5f, 2.2f); ring(7f, 18.5f, 2.2f); ring(17f, 8.5f, 2.2f); line(7f, 7.7f, 7f, 16.3f); path { moveTo(17f, 10.7f); cubicTo(17f, 14.5f, 7f, 13f, 7f, 16.3f) } }
            Glyph.Upload -> { path { moveTo(12f, 15.5f); lineTo(12f, 4.5f); moveTo(7f, 9.5f); lineTo(12f, 4.5f); lineTo(17f, 9.5f) }; path { moveTo(4.5f, 14.5f); lineTo(4.5f, 19.5f); lineTo(19.5f, 19.5f); lineTo(19.5f, 14.5f) } }
            Glyph.Box -> { path { moveTo(12f, 3f); lineTo(20f, 7.5f); lineTo(20f, 16.5f); lineTo(12f, 21f); lineTo(4f, 16.5f); lineTo(4f, 7.5f); close() }
                path { moveTo(4f, 7.5f); lineTo(12f, 12f); lineTo(20f, 7.5f); moveTo(12f, 12f); lineTo(12f, 21f) } }
            Glyph.Eye -> { path { moveTo(2.5f, 12f); quadraticTo(12f, 3.5f, 21.5f, 12f); quadraticTo(12f, 20.5f, 2.5f, 12f); close() }; ring(12f, 12f, 3f) }
            Glyph.More -> { dot(6f, 12f, 1.7f); dot(12f, 12f, 1.7f); dot(18f, 12f, 1.7f) }
            Glyph.Trash -> { line(4.5f, 7f, 19.5f, 7f); path { moveTo(9.5f, 7f); lineTo(9.5f, 4.5f); lineTo(14.5f, 4.5f); lineTo(14.5f, 7f) }
                path { moveTo(6.5f, 7f); lineTo(7.5f, 20f); lineTo(16.5f, 20f); lineTo(17.5f, 7f) }; line(10.5f, 11f, 10.5f, 16f); line(13.5f, 11f, 13.5f, 16f) }
            Glyph.Stop -> drawRoundRect(color, Offset(6.5f, 6.5f), Size(11f, 11f), CornerRadius(2.5f))
            Glyph.Edit -> { path { moveTo(4f, 20f); lineTo(4.6f, 15.4f); lineTo(16f, 4f); quadraticTo(17.6f, 2.8f, 19.2f, 4.4f); quadraticTo(20.8f, 6f, 19.6f, 7.6f); lineTo(8.2f, 19f); close() }; line(13.6f, 6.4f, 17.6f, 10.4f) }
            Glyph.Power -> { arc(4f, 4f, 16f, 310f, 280f); line(12f, 3f, 12f, 11.5f) }
            Glyph.Star -> path {
                for (i in 0 until 10) {
                    val angle = Math.toRadians(i * 36.0 - 90.0); val r = if (i % 2 == 0) 9.5f else 4.2f
                    val x = 12f + cos(angle).toFloat() * r; val y = 12.8f + sin(angle).toFloat() * r
                    if (i == 0) moveTo(x, y) else lineTo(x, y)
                }
                close()
            }
            Glyph.Home -> { path { moveTo(3.5f, 11f); lineTo(12f, 4f); lineTo(20.5f, 11f); moveTo(6f, 9.5f); lineTo(6f, 20f); lineTo(18f, 20f); lineTo(18f, 9.5f) }; path { moveTo(10f, 20f); lineTo(10f, 14.5f); lineTo(14f, 14.5f); lineTo(14f, 20f) } }
            Glyph.Gauge -> { arc(3.5f, 5f, 17f, 180f, 180f); line(12f, 14f, 16.2f, 9.2f); dot(12f, 14f, 1.6f); line(3.5f, 13.5f, 20.5f, 13.5f) }
        }
    }
}
