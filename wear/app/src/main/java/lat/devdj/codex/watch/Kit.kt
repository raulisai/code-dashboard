package lat.devdj.codex.watch

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.ChildButton
import androidx.wear.compose.material3.FilledTonalButton
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import kotlinx.coroutines.launch

internal val Ice = Color(0xFF9DE4FF)
internal val Dim = Color(0xFF8F9BA8)
internal val Panel = Color(0xFF10171F)
internal val Track = Color(0xFF1E2833)
internal val Paper = Color(0xFFF1F5F9)
internal val Mint = Color(0xFF7EE2A8)
internal val Amber = Color(0xFFFFC46B)
internal val Coral = Color(0xFFFF8E7B)
internal val Ember = Color(0xFFEB9A72)
internal val Sky = Color(0xFF8DB7FF)

internal fun Level.color() = when (this) { Level.Good -> Mint; Level.Warn -> Amber; Level.Low -> Coral }

/** Where each page was scrolled, so coming back to it (swipe or button) lands on the same spot. */
internal val LocalScrollMemory = compositionLocalOf { HashMap<Any, Int>() }

/** Vertical page with the Wear scroll indicator, rotary crown scrolling and round-screen safe margins. */
@Composable internal fun ScrollPage(stateKey: Any = Unit, top: Dp = 38.dp, backToTop: Any? = null, content: @Composable ColumnScope.() -> Unit) {
    val memory = LocalScrollMemory.current
    val scroll = rememberScrollState(memory[stateKey] ?: 0)
    val focus = remember { FocusRequester() }
    val scope = rememberCoroutineScope()
    DisposableEffect(stateKey) { onDispose { memory[stateKey] = scroll.value } }
    // A new [backToTop] (not the first one seen) brings the page back up, e.g. to watch the answer to a shortcut.
    var seen by remember { mutableStateOf(backToTop) }
    LaunchedEffect(backToTop) { if (backToTop != seen) { seen = backToTop; scroll.animateScrollTo(0) } }
    LaunchedEffect(Unit) { focus.requestFocus() }
    ScreenScaffold(scroll, contentPadding = PaddingValues(start = 22.dp, top = top, end = 22.dp, bottom = 34.dp)) { padding ->
        Column(Modifier.fillMaxSize().onRotaryScrollEvent { event -> scope.launch { scroll.scrollBy(event.verticalScrollPixels) }; true }
            .focusRequester(focus).focusable().verticalScroll(scroll).padding(padding),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
    }
}

/** List row: tinted line icon, one line of text and an optional dimmer detail underneath. */
@Composable internal fun Action(label: String, enabled: Boolean = true, subtle: Boolean = false, glyph: Glyph? = null,
                                tint: Color = Ice, detail: String = "", onClick: () -> Unit) {
    val colors = if (subtle) ButtonDefaults.childButtonColors(contentColor = Dim, secondaryContentColor = Dim, iconColor = Dim)
    else ButtonDefaults.filledTonalButtonColors(containerColor = Panel, contentColor = Paper, secondaryContentColor = Dim, iconColor = tint)
    val icon: (@Composable BoxScope.() -> Unit)? = glyph?.let { { GlyphIcon(it, if (enabled) (if (subtle) Dim else tint) else Dim, size = 22.dp) } }
    val text: @Composable RowScope.() -> Unit = {
        Text(label, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = if (glyph == null) TextAlign.Center else TextAlign.Start,
            modifier = if (glyph == null) Modifier.fillMaxWidth() else Modifier)
    }
    val second: (@Composable RowScope.() -> Unit)? = detail.takeIf { it.isNotBlank() }?.let { { Text(it, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) } }
    if (subtle) ChildButton(onClick, Modifier.fillMaxWidth(), secondaryLabel = second, icon = icon, enabled = enabled, colors = colors, label = text)
    else FilledTonalButton(onClick, Modifier.fillMaxWidth(), secondaryLabel = second, icon = icon, enabled = enabled, colors = colors, label = text)
}

/** Icon-only circle. Always carries a spoken description because it has no visible label. */
@Composable internal fun RoundButton(glyph: Glyph, description: String, tint: Color = Ice, size: Dp = 48.dp, dot: Color? = null,
                                     enabled: Boolean = true, onClick: () -> Unit) {
    Box(Modifier.size(size).clip(CircleShape).background(Panel).semantics { contentDescription = description }
        .clickable(enabled = enabled, role = Role.Button, onClick = onClick), contentAlignment = Alignment.Center) {
        GlyphIcon(glyph, if (enabled) tint else Dim, size = size * 0.46f)
        if (dot != null) Box(Modifier.align(Alignment.TopEnd).padding(size * 0.1f).size(9.dp).clip(CircleShape).background(dot))
    }
}

/** Provider quota as a ring around its mark; the arc is what is left of the 5-hour window. */
@Composable internal fun QuotaRing(glyph: Glyph, tint: Color, left: Int?, size: Dp = 34.dp) {
    val color = levelOf(left).color()
    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val width = 3.2.dp.toPx(); val box = Size(this.size.width - width, this.size.height - width)
            drawArc(Track, 0f, 360f, false, Offset(width / 2, width / 2), box, style = Stroke(width))
            if (left != null) drawArc(color, -90f, 360f * left / 100f, false, Offset(width / 2, width / 2), box, style = Stroke(width, cap = StrokeCap.Round))
        }
        GlyphIcon(glyph, tint, size = size * 0.46f)
    }
}

@Composable internal fun Heading(text: String, glyph: Glyph? = null, tint: Color = Ice) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally)) {
        if (glyph != null) GlyphIcon(glyph, tint, size = 18.dp)
        Text(text, color = tint, fontSize = 16.sp, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
    }
}

@Composable internal fun Note(text: String) { if (text.isNotBlank()) Text(text, color = Dim, fontSize = 12.sp, textAlign = TextAlign.Center) }

@Composable internal fun ErrorText(text: String) {
    if (text.isNotBlank()) Text(text, color = Amber, fontSize = 12.sp, textAlign = TextAlign.Center)
}

@Composable internal fun Field(value: String, description: String, enabled: Boolean = true, onChange: (String) -> Unit) {
    BasicTextField(value, onChange, enabled = enabled, maxLines = 4, textStyle = TextStyle(color = Color.White, fontSize = 14.sp),
        cursorBrush = SolidColor(Ice), modifier = Modifier.fillMaxWidth().heightIn(min = 60.dp)
            .clip(RoundedCornerShape(16.dp)).background(Panel).semantics { contentDescription = description }.padding(12.dp),
        decorationBox = { inner -> if (value.isBlank()) Text("Escribe aquí…", color = Dim, fontSize = 14.sp); inner() })
}
