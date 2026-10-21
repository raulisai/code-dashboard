package lat.devdj.codex.watch

import android.Manifest
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Text
import kotlinx.coroutines.launch

private fun noticeGlyph(notice: Notice) = when (notice.kind) { "approval" -> Glyph.Shield; "error" -> Glyph.Alert; else -> Glyph.Check }
private fun noticeTint(notice: Notice) = when (notice.kind) { "approval" -> Amber; "error" -> Coral; else -> Mint }
private fun noticeLabel(notice: Notice) = notice.title.ifBlank { when (notice.kind) { "approval" -> "Pide tu aprobación"; "error" -> "Necesita atención"; else -> "Respuesta lista" } }
private fun noticeDetail(notice: Notice, now: Long) = listOf(notice.where, ago(notice.at, now)).filter { it.isNotBlank() }.joinToString(" · ")

private fun openNotice(nav: Nav, notice: Notice) = nav.push(when {
    notice.kind == "approval" -> Dest.Tool(WatchRoute("approvals"))
    notice.general -> Dest.Reply
    else -> Dest.Tool(WatchRoute("agent", notice.project))
})

/** First screen: the general agent (tap the orb to talk), what its coding agents have left, and the latest news. */
@Composable internal fun HomeScreen(model: WatchViewModel, state: WatchUi, listening: Boolean, onTalk: () -> Unit) {
    val nav = model.nav
    val scope = rememberCoroutineScope()
    val now = System.currentTimeMillis() / 1000
    val large = LocalDensity.current.fontScale > 1.2f
    val screen = LocalConfiguration.current.screenHeightDp
    // The first screen is exactly one display tall; the orb takes whatever the other three rows leave.
    val orb = (screen - 34 - 18 - 34 - 30 - 20).coerceIn(56, 84).dp
    ScrollPage("home", top = 0.dp) {
        Column(Modifier.fillMaxWidth().height(screen.dp).padding(top = 20.dp, bottom = 14.dp), Arrangement.SpaceEvenly, Alignment.CenterHorizontally) {
            StatusLine(state)
            Orb(state = if (listening) "listening" else state.state, active = state.working || listening, diameter = orb, onTap = onTalk)
            QuotaDuo(state) { nav.push(Dest.Quota) }
            Glance(state, large, nav)
        }
        if (state.notices.isNotEmpty()) {
            Heading("Avisos", Glyph.Bell)
            for (notice in state.notices.take(3)) Action(noticeLabel(notice), glyph = noticeGlyph(notice), tint = noticeTint(notice), detail = noticeDetail(notice, now)) { openNotice(nav, notice) }
            Action("Ver todos", subtle = true, glyph = Glyph.Chevron) { nav.push(Dest.Alerts) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            Dock(Glyph.Folder, "Proyectos") { nav.push(Dest.Tool(WatchRoute("projects"))) }
            Dock(Glyph.Shield, "Aprobaciones", if (state.approvals > 0) Amber else null) { nav.push(Dest.Tool(WatchRoute("approvals"))) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            Dock(Glyph.Server, "Servidor") { nav.push(Dest.Tool(WatchRoute("server"))) }
            Dock(Glyph.Sliders, "Ajustes") { nav.push(Dest.Tool(WatchRoute("settings"))) }
        }
        Action(if (state.pending) "Reintentar envío" else "Escribir", glyph = if (state.pending) Glyph.Refresh else Glyph.Keyboard, tint = if (state.pending) Amber else Ice) { nav.push(Dest.Compose) }
        Action("Última tarea", glyph = Glyph.Clock) { model.draft("¿Cómo va la última tarea? Dime el proyecto y su estado actual."); nav.push(Dest.Compose) }
        Action("¿Qué proyectos tenemos?", glyph = Glyph.Folder) { model.draft("¿Qué proyectos tenemos? Dime sus nombres de forma breve."); nav.push(Dest.Compose) }
        Action("Actualizar", subtle = true, glyph = Glyph.Refresh) { scope.launch { model.refreshAll() } }
        ErrorText(state.error)
    }
}

@Composable private fun StatusLine(state: WatchUi) {
    val color = when {
        state.error.isNotBlank() || state.state in setOf("attention", "error") -> Amber
        state.working -> Mint
        else -> Ice
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(7.dp).clip(CircleShape).background(color))
        Text(state.label, color = if (state.error.isBlank()) Paper else Amber, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

private fun spoken(name: String, quota: ProviderQuota?) = name + (quota?.left?.let { " $it por ciento libre" } ?: " sin datos")

@Composable private fun QuotaDuo(state: WatchUi, onClick: () -> Unit) {
    val description = "Cuota de tus agentes: " + spoken("Claude", state.claude) + ", " + spoken("Codex", state.codex)
    // Narrow displays and large text shrink the rings; the row may spill into the side margins rather than wrap.
    val ring = if (LocalConfiguration.current.screenWidthDp < 200 || LocalDensity.current.fontScale > 1.2f) 28.dp else 34.dp
    Row(Modifier.wrapContentWidth(unbounded = true).clip(RoundedCornerShape(20.dp)).semantics { contentDescription = description }
        .clickable(role = Role.Button, onClick = onClick).padding(horizontal = 8.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        QuotaPill(Glyph.Sparkle, Ember, state.claude, ring)
        QuotaPill(Glyph.Code, Sky, state.codex, ring)
    }
}

@Composable private fun QuotaPill(glyph: Glyph, tint: Color, quota: ProviderQuota?, ring: Dp) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        QuotaRing(glyph, tint, quota?.left, ring)
        Text(quota?.left?.let { "$it%" } ?: "–", fontSize = 13.sp, color = if (quota == null) Dim else Paper, maxLines = 1, softWrap = false)
    }
}

/** One line under the quota: the fresh reply if there is one, otherwise the newest notice. */
@Composable private fun Glance(state: WatchUi, large: Boolean, nav: Nav) {
    val notice = state.notices.firstOrNull()
    when {
        state.pending -> GlanceRow(Glyph.Refresh, Amber, "Mensaje por enviar · toca para reintentar", 2) { nav.push(Dest.Compose) }
        state.freshReply && state.reply.isNotBlank() && !state.working ->
            GlanceRow(Glyph.Chat, Ice, state.reply, if (large) 1 else 2) { nav.push(Dest.Reply) }
        notice != null -> GlanceRow(noticeGlyph(notice), noticeTint(notice), notice.where + " · " + noticeLabel(notice), if (large) 1 else 2) { nav.push(Dest.Alerts) }
        else -> Text(if (state.working) "Puedes seguir hablándome" else "Toca la esfera para hablar", color = Dim, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable private fun GlanceRow(glyph: Glyph, tint: Color, text: String, lines: Int, onClick: () -> Unit) {
    Row(Modifier.widthIn(max = 140.dp).clip(RoundedCornerShape(14.dp)).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        GlyphIcon(glyph, tint, size = 14.dp)
        Text(text, fontSize = 11.sp, color = Dim, maxLines = lines, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
    }
}

@Composable private fun Dock(glyph: Glyph, label: String, dot: Color? = null, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        RoundButton(glyph, label, size = 52.dp, dot = dot, onClick = onClick)
        Text(label, fontSize = 10.sp, color = Dim, maxLines = 1)
    }
}

@Composable internal fun AlertsScreen(model: WatchViewModel, state: WatchUi) {
    val nav = model.nav
    val scope = rememberCoroutineScope()
    val now = System.currentTimeMillis() / 1000
    ScrollPage("alerts") {
        Heading("Avisos", Glyph.Bell)
        if (state.notices.isEmpty()) Note("Todo tranquilo. Aquí verás lo que terminen o necesiten tus agentes.")
        for (notice in state.notices) Action(noticeLabel(notice), glyph = noticeGlyph(notice), tint = noticeTint(notice), detail = noticeDetail(notice, now)) { openNotice(nav, notice) }
        Action("Configurar avisos", glyph = Glyph.Sliders) { nav.push(Dest.Push) }
        Action("Actualizar", subtle = true, glyph = Glyph.Refresh) { scope.launch { model.loadHome() } }
    }
}

@Composable internal fun QuotaScreen(model: WatchViewModel, state: WatchUi) {
    val scope = rememberCoroutineScope()
    ScrollPage("quota") {
        Heading("Cuota", Glyph.Gauge)
        if (!state.quotaLoaded) Note("Consultando cuota…")
        QuotaCard("Claude Code", Glyph.Sparkle, Ember, state.claude, state.quotaLoaded)
        QuotaCard("Codex", Glyph.Code, Sky, state.codex, state.quotaLoaded)
        bestAgent(state.claude, state.codex)?.let { Note("Ahora conviene $it") }
        if (state.quotaStale) Note("Cuota sin actualizar")
        Action("Actualizar", subtle = true, glyph = Glyph.Refresh) { scope.launch { model.loadQuota(true) } }
    }
}

@Composable private fun QuotaCard(name: String, glyph: Glyph, tint: Color, quota: ProviderQuota?, loaded: Boolean) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Panel).padding(12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            QuotaRing(glyph, tint, quota?.left, 30.dp)
            Text(name, fontSize = 14.sp, color = Paper, fontWeight = FontWeight.Medium)
        }
        if (quota == null) Note(if (loaded) "No disponible" else "…")
        else { QuotaWindowRow("5 horas", quota.session); QuotaWindowRow("Semanal", quota.weekly) }
    }
}

@Composable private fun QuotaWindowRow(label: String, window: QuotaWindow?) {
    if (window == null) return
    Text("$label · ${window.left}% libre", fontSize = 12.sp, color = Paper)
    Box(Modifier.fillMaxWidth().height(5.dp).clip(CircleShape).background(Track)) {
        Box(Modifier.fillMaxWidth(window.left / 100f).fillMaxHeight().background(levelOf(window.left).color()))
    }
    if (window.resetsAt > 0) Text("Renueva " + android.text.format.DateFormat.format("dd/MM HH:mm", window.resetsAt * 1000), fontSize = 11.sp, color = Dim)
}

/** Sends the draft and returns to the first screen, scrolled back to the agent so its reaction is the first thing seen. */
private fun sent(model: WatchViewModel) { model.send(); model.hub.scroll["home"] = 0; model.nav.pop() }

@Composable internal fun ComposeScreen(model: WatchViewModel, state: WatchUi, voiceError: String, onTalk: () -> Unit) {
    ScrollPage("compose") {
        Heading(if (state.pending) "Pendiente de confirmar" else "¿Qué hacemos?", Glyph.Keyboard)
        // Actions first: they stay in reach however long the message grows.
        if (state.pending) {
            Note("Reintenta el mismo envío. No se duplicará.")
            Action(if (state.busy) "Enviando…" else "Reintentar envío", !state.busy, glyph = Glyph.Refresh) { sent(model) }
        } else Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            RoundButton(Glyph.Mic, "Dictar", onClick = onTalk)
            RoundButton(Glyph.Send, "Enviar", tint = Mint, enabled = !state.busy && state.draft.isNotBlank()) { sent(model) }
        }
        Field(state.draft, "Mensaje al agente", !state.pending) { model.draft(it) }
        ErrorText(state.error.ifBlank { voiceError })
    }
}

@Composable internal fun ReplyScreen(state: WatchUi, onSpeak: (String) -> Unit, onTalk: () -> Unit) {
    ScrollPage("reply") {
        Heading("Tu respuesta", Glyph.Chat)
        if (state.question.isNotBlank()) Note(state.question)
        Text(state.reply.ifBlank { if (state.working) "Estoy en ello…" else "Pregúntame lo que necesites." }, fontSize = 15.sp, color = Paper, textAlign = TextAlign.Center)
        if (state.updated > 0) Note("Actualizado " + android.text.format.DateFormat.format("HH:mm", state.updated * 1000))
        ErrorText(state.error)
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            if (state.reply.isNotBlank()) RoundButton(Glyph.Speaker, "Escuchar") { onSpeak(state.reply) }
            RoundButton(Glyph.Mic, "Seguir hablando", onClick = onTalk)
        }
    }
}

@Composable internal fun PushScreen(model: WatchViewModel, state: WatchUi, onPermission: (String) -> Unit, voiceError: String) {
    ScrollPage("push") {
        Heading("Avisos del reloj", Glyph.Bell)
        Note(if (model.store.json("firebase") == null) "Pendientes de configurar en el servidor. La conversación ya funciona." else "Solo lo necesario. Tú eliges.")
        for ((mode, label) in listOf("attention" to "Solo atención", "all" to "También respuestas", "off" to "Sin avisos")) {
            val chosen = state.mode == mode
            Action(label, glyph = if (chosen) Glyph.Check else Glyph.Bell, tint = if (chosen) Mint else Dim) {
                if (mode != "off") onPermission(Manifest.permission.POST_NOTIFICATIONS)
                model.notificationMode(mode)
            }
        }
        ErrorText(voiceError.ifBlank { state.error })
    }
}

@Composable internal fun UnlinkScreen(model: WatchViewModel, state: WatchUi) {
    ScrollPage("unlink") {
        Heading("¿Desvincular?", Glyph.Power, Coral)
        Note("Se revoca el acceso de este reloj y se borra su copia local.")
        Action("Desvincular", glyph = Glyph.Power, tint = Coral) { model.disconnect(); model.nav.home() }
        Action("Cancelar", subtle = true, glyph = Glyph.Close) { model.nav.pop() }
        ErrorText(state.error)
    }
}

@Composable internal fun PairScreen(model: WatchViewModel, state: WatchUi) {
    ScrollPage("pair") {
        Heading("Tu agente, aquí", Glyph.Sparkle)
        Text(if (state.code.isBlank()) "Preparando vínculo…" else state.code.chunked(4).joinToString(" "), fontSize = 23.sp, color = Ice, fontWeight = FontWeight.Medium)
        Note("En tu móvil o computadora:\nDashboard → Ajustes → Tu reloj")
        if (state.code.isNotBlank()) Note("El código dura 5 minutos")
        ErrorText(state.error)
        Action("Nuevo código", !state.busy, glyph = Glyph.Refresh) { model.retryPair() }
        var editing by remember { mutableStateOf(false) }
        var server by remember { mutableStateOf(state.origin) }
        if (editing) {
            Field(server, "Servidor HTTPS") { server = it }
            Action("Guardar servidor", glyph = Glyph.Check) { model.origin(server); editing = false }
        } else Action("Servidor", subtle = true, glyph = Glyph.Server) { editing = true }
    }
}
