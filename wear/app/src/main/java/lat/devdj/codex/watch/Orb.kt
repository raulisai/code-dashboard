package lat.devdj.codex.watch

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** 72 points, no blur, textures, network or idle animation. Stops with activity lifecycle. */
@Composable fun Orb(state: String, active: Boolean, diameter: Dp = 84.dp, onTap: () -> Unit) {
    val owner = LocalLifecycleOwner.current
    var phase by remember { mutableFloatStateOf(0f) }
    val context = LocalContext.current
    val motion = android.provider.Settings.Global.getFloat(context.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f
    LaunchedEffect(active, motion, owner) {
        if (active && motion) owner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) { delay(50); phase += 0.025f }
        }
    }
    val color = when (state) { "attention", "error" -> Color(0xFFFFBA84); "listening" -> Color(0xFFB3F4D0); else -> Ice }
    val orbSize = (diameter.value / LocalDensity.current.fontScale.coerceAtLeast(1f)).coerceIn(52f, diameter.value).dp
    Canvas(Modifier.size(orbSize).clip(CircleShape).semantics { contentDescription = "Hablar con el agente general" }
        .clickable(role = Role.Button, onClick = onTap)) {
        val radius = size.minDimension * 0.38f
        val center = Offset(size.width / 2, size.height / 2)
        drawCircle(Brush.radialGradient(listOf(color.copy(alpha = .14f), Color.Transparent), center, radius * 1.3f), radius * 1.3f, center)
        for (i in 0 until 72) {
            val y = 1f - 2f * (i + .5f) / 72f
            val r = sqrt(1f - y * y)
            val angle = i * 2.399963f + phase
            val x = cos(angle) * r; val z = sin(angle) * r
            drawCircle(color.copy(alpha = .22f + .74f * (z + 1f) / 2f), 1.1f + (z + 1f) * .7f, center + Offset(x * radius, y * radius))
        }
        if (active) drawArc(color.copy(alpha = .65f), phase * 70, 78f, false,
            topLeft = center - Offset(radius * 1.15f, radius * 1.15f), size = Size(radius * 2.3f, radius * 2.3f), style = Stroke(1.4f, cap = StrokeCap.Round))
    }
}
