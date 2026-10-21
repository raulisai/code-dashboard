package lat.devdj.codex.watch

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.wear.compose.foundation.SwipeToDismissValue
import androidx.wear.compose.foundation.rememberSwipeToDismissBoxState
import androidx.wear.compose.material3.SwipeToDismissBox
import org.json.JSONObject

internal sealed interface Dest {
    data object Home : Dest
    data object Compose : Dest
    data object Reply : Dest
    data object Alerts : Dest
    data object Quota : Dest
    data object Push : Dest
    data object Unlink : Dest
    data class Tool(val route: WatchRoute) : Dest
    data class Op(val route: WatchRoute, val op: Operation) : Dest
}

internal class Frame(val id: Int, val dest: Dest)

/** Back stack of the whole app. It lives in the ViewModel so a font-size or display change keeps the user where they were. */
class Nav {
    private var next = 1
    internal val stack = mutableStateListOf(Frame(0, Dest.Home))
    internal val top get() = stack.last().dest
    internal fun push(dest: Dest) { stack.add(Frame(next++, dest)) }
    fun pop(): Boolean { if (stack.size <= 1) return false; stack.removeAt(stack.lastIndex); return true }
    fun home() { while (stack.size > 1) stack.removeAt(stack.lastIndex) }
    internal fun open(dest: Dest) { home(); push(dest) }
}

/** Last server answer per tool screen, remembered scroll positions and a one-line result to show after a confirmed action. */
class ToolHub {
    // Both maps forget their least recently used entry, so a long session of browsing files stays small.
    internal val cache = recent<WatchRoute, JSONObject>(24)
    val scroll = recent<Any, Int>(48)
    var flash by mutableStateOf("")
    private fun <K, V> recent(limit: Int) = object : LinkedHashMap<K, V>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<K, V>) = size > limit
    }
}

/**
 * Wear OS swipe-to-dismiss: dragging right from anywhere shows the previous screen under the finger and
 * pops it. On the first screen the gesture is left to the system, which leaves the app like any Wear app.
 */
@Composable internal fun Screens(nav: Nav, page: @Composable (Frame, Boolean) -> Unit) {
    val state = rememberSwipeToDismissBoxState()
    LaunchedEffect(state.currentValue) {
        if (state.currentValue == SwipeToDismissValue.Dismissed) { state.snapTo(SwipeToDismissValue.Default); nav.pop() }
    }
    val top = nav.stack.last()
    val below = nav.stack.getOrNull(nav.stack.lastIndex - 1)
    SwipeToDismissBox(state, userSwipeEnabled = below != null, backgroundKey = below?.id ?: -1, contentKey = top.id) { behind ->
        if (behind) { if (below != null) page(below, false) } else page(top, true)
    }
}
