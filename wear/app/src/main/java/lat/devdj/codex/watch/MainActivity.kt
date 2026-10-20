package lat.devdj.codex.watch

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import android.speech.RecognizerIntent
import android.speech.tts.TextToSpeech
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale
import kotlin.math.*

private val Ice = Color(0xFF9DE4FF)
private val Dim = Color(0xFF8F9BA8)
private val Panel = Color(0xFF10171F)

class MainActivity : ComponentActivity() {
    private val model: WatchViewModel by viewModels()
    private var openReply by mutableStateOf(false)
    private var openDashboard by mutableStateOf(false)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        openReply = intent.getBooleanExtra("show_reply", false)
        openDashboard = intent.getBooleanExtra("show_dashboard", false)
        lifecycleScope.launch { repeatOnLifecycle(Lifecycle.State.RESUMED) { model.foreground() } }
        setContent { MaterialTheme { WatchApp(model, openReply, openDashboard = openDashboard) { openReply = false; openDashboard = false } } }
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        openReply = intent.getBooleanExtra("show_reply", false)
        openDashboard = intent.getBooleanExtra("show_dashboard", false)
    }
    override fun onStop() {
        model.persistDraft()
        super.onStop()
    }
}

@Composable
fun WatchApp(model: WatchViewModel, openReply: Boolean = false, initialPage: String = "dashboard", openDashboard: Boolean = false, consumed: () -> Unit = {}) {
    val state by model.ui.collectAsStateWithLifecycle()
    var page by remember { mutableStateOf(initialPage) }
    LaunchedEffect(page) { model.generalVisible(page in setOf("home", "compose", "reply")) }
    DisposableEffect(model) { onDispose { model.generalVisible(false) } }
    var voiceError by remember { mutableStateOf("") }
    var listening by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val largeText = LocalDensity.current.fontScale > 1.2f
    val scope = rememberCoroutineScope()
    var tts by remember { mutableStateOf<TextToSpeech?>(null) }
    DisposableEffect(Unit) {
        val engine = TextToSpeech(context) { }
        tts = engine
        onDispose { engine.stop(); engine.shutdown() }
    }
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_PAUSE) tts?.stop()
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(openReply) { if (openReply) {page = "reply"; consumed()} }
    LaunchedEffect(openDashboard) { if (openDashboard) {page = "dashboard"; consumed()} }
    BackHandler(page !in setOf("home", "dashboard", "projects", "settings")) { page = "home" }
    val dictate = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        listening = false
        val text = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (!text.isNullOrBlank()) { model.draft(text); page = "compose" }
    }
    val notifyPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        voiceError = if (granted) "" else "Puedes permitir los avisos en Ajustes del reloj."
    }
    val talk = {
        if (state.pending) page = "compose" else {
            tts?.stop(); voiceError = ""
            try {
                dictate.launch(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-MX")
                    .putExtra(RecognizerIntent.EXTRA_PROMPT, "¿Qué hacemos?"))
                listening = true
            } catch (_: ActivityNotFoundException) { voiceError = "Dictado no disponible. Puedes escribir."; page = "compose" }
        }
    }
    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        if (!state.linked) {
            ScrollPage {
                Text("CODEX", color = Ice, fontSize = 11.sp, letterSpacing = 2.sp)
                Text("Tu agente, aquí", fontSize = 18.sp, textAlign = TextAlign.Center)
                Spacer(Modifier.height(4.dp))
                Text(if (state.code.isBlank()) "Preparando vínculo…" else state.code.chunked(4).joinToString(" "),
                    fontSize = 23.sp, color = Ice, fontWeight = FontWeight.Medium)
                Text("En tu móvil o computadora:\nDashboard → Ajustes → Tu reloj", color = Dim, fontSize = 12.sp, textAlign = TextAlign.Center)
                if (state.code.isNotBlank()) Text("El código dura 5 minutos", color = Dim, fontSize = 11.sp)
                ErrorText(state.error)
                Action("Nuevo código", enabled = !state.busy) { model.retryPair() }
                var editing by remember { mutableStateOf(false) }
                var server by remember { mutableStateOf(state.origin) }
                if (editing) {
                    Field(server, "Servidor HTTPS") { server = it }
                    Action("Guardar servidor") { model.origin(server); editing = false }
                } else Action("Servidor", subtle = true) { editing = true }
            }
        } else when (page) {
            "dashboard", "projects", "settings" -> WatchDashboard(model, when(page) {"projects" -> "projects"; "settings" -> "settings"; else -> "overview"},
                onAgent = { page = "home" }, onNotifications = { page = "notifications" }, onDisconnect = { page = "disconnect" })
            "home" -> {
                Column(Modifier.fillMaxSize().padding(horizontal = 25.dp, vertical = 14.dp), horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.SpaceBetween) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
                        Text("GENERAL", color = Dim, fontSize = 10.sp, letterSpacing = 1.6.sp)
                    }
                    Orb(state = if (listening) "listening" else state.state, active = state.working || listening, onTap = talk)
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(state.label, color = if (state.error.isBlank()) Color.White else Color(0xFFFFC397), fontSize = 14.sp,
                            maxLines = 2, textAlign = TextAlign.Center, overflow = TextOverflow.Ellipsis)
                        if (state.freshReply && state.reply.isNotBlank() && !state.working) {
                            Text(state.reply, Modifier.clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button) {page = "reply"}.padding(4.dp),
                                color = Dim, fontSize = 12.sp, maxLines = if (largeText) 1 else 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
                        } else Text(if (state.working) "Puedes seguir hablándome" else "Toca la esfera para hablar", color = Dim, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SmallAction(if (state.pending) "Reintentar" else "Escribir") { page = "compose" }
                        SmallAction("···", "Más opciones") { page = "menu" }
                    }
                }
            }
            "compose" -> ScrollPage {
                Text(if (state.pending) "Pendiente de confirmar" else "¿Qué hacemos?", fontSize = 17.sp, textAlign = TextAlign.Center)
                Text(if (state.pending) "Reintenta el mismo envío. No se duplicará." else "Revisa tu mensaje antes de enviarlo.", color = Dim, fontSize = 11.sp, textAlign = TextAlign.Center)
                Field(state.draft, "Mensaje al agente", !state.pending) { model.draft(it) }
                ErrorText(state.error.ifBlank { voiceError })
                Action(if (state.busy) "Enviando…" else if (state.pending) "Reintentar envío" else "Enviar", !state.busy && state.draft.isNotBlank()) {
                    model.send(); page = "home"
                }
                if (!state.pending) Action("Dictar", subtle = true, onClick = talk)
                Action("Volver", subtle = true) { page = "home" }
            }
            "reply" -> ScrollPage {
                Text("Tu respuesta", color = Ice, fontSize = 15.sp)
                if (state.question.isNotBlank()) Text(state.question, fontSize = 11.sp, color = Dim, textAlign = TextAlign.Center)
                Text(state.reply.ifBlank { if (state.working) "Estoy en ello…" else "Pregúntame lo que necesites." }, fontSize = 15.sp, textAlign = TextAlign.Center)
                if (state.updated > 0) Text("Actualizado " + android.text.format.DateFormat.format("HH:mm", state.updated * 1000), fontSize = 10.sp, color = Dim)
                ErrorText(state.error)
                if (state.reply.isNotBlank()) Action("Escuchar", subtle = true) {
                    tts?.language = Locale.forLanguageTag("es-MX")
                    tts?.speak(state.reply, TextToSpeech.QUEUE_FLUSH, null, "reply")
                }
                Action("Seguir hablando", onClick = talk)
                Action("Volver", subtle = true) { page = "home" }
            }
            "notifications" -> ScrollPage {
                Text("Avisos", color = Ice, fontSize = 16.sp)
                Text(if (model.store.json("firebase") == null) "Pendientes de configurar en el servidor. La conversación ya funciona." else "Solo lo necesario. Tú eliges.", color = Dim, fontSize = 12.sp, textAlign = TextAlign.Center)
                for ((mode, label) in listOf("attention" to "Solo atención", "all" to "También respuestas", "off" to "Sin avisos")) {
                    Action((if (state.mode == mode) "✓ " else "") + label) {
                        if (mode != "off") notifyPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                        model.notificationMode(mode)
                    }
                }
                ErrorText(voiceError.ifBlank {state.error})
                Action("Volver", subtle = true) { page = "home" }
            }
            "disconnect" -> ScrollPage {
                Text("¿Desvincular?", color = Ice, fontSize = 16.sp)
                Text("Se revoca el acceso de este reloj y se borra su copia local.", color = Dim, fontSize = 12.sp, textAlign = TextAlign.Center)
                Action("Desvincular") { model.disconnect(); page = "home" }
                Action("Cancelar", subtle = true) { page = "menu" }
                ErrorText(state.error)
            }
            else -> ScrollPage {
                Text("A tu alcance", fontSize = 16.sp, color = Ice)
                Action("Inicio") { page = "dashboard" }
                Action("Proyectos") { page = "projects" }
                Action("Configuración") { page = "settings" }
                Action("Última tarea") { model.draft("¿Cómo va la última tarea? Dime el proyecto y su estado actual."); page = "compose" }
                Action("¿Qué proyectos tenemos?") {model.draft("¿Qué proyectos tenemos? Dime sus nombres de forma breve."); page = "compose"}
                Action("Ver respuesta") { page = "reply" }
                Action("Actualizar", subtle = true) { scope.launch {model.refresh()} }
                Action("Avisos", subtle = true) { page = "notifications" }
                Action("Desvincular", subtle = true) { page = "disconnect" }
                Action("Volver", subtle = true) { page = "home" }
                ErrorText(state.error)
            }
        }
    }
}

@Composable internal fun ScrollPage(resetKey: String = "", content: @Composable ColumnScope.() -> Unit) {
    val scroll = rememberScrollState()
    val focus = remember { FocusRequester() }
    val scope = rememberCoroutineScope()
    LaunchedEffect(resetKey) { scroll.scrollTo(0); focus.requestFocus() }
    Column(Modifier.fillMaxSize().onRotaryScrollEvent { event -> scope.launch { scroll.scrollBy(event.verticalScrollPixels) }; true }
        .focusRequester(focus).focusable().verticalScroll(scroll).padding(horizontal = 30.dp, vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(9.dp), content = content)
}

@Composable internal fun Action(label: String, enabled: Boolean = true, subtle: Boolean = false, onClick: () -> Unit) {
    Box(Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(24.dp))
        .background(if (subtle) Color.Transparent else Panel).clickable(enabled = enabled, role = Role.Button, onClick = onClick)
        .padding(horizontal = 10.dp, vertical = 12.dp), contentAlignment = Alignment.Center) {
        Text(label, color = if (!enabled) Dim else if (subtle) Dim else Ice, fontSize = 13.sp, textAlign = TextAlign.Center)
    }
}

@Composable private fun SmallAction(label: String, description: String = label, onClick: () -> Unit) {
    Box(Modifier.widthIn(max = 92.dp).defaultMinSize(minWidth = 48.dp, minHeight = 48.dp).clip(CircleShape).background(Panel)
        .semantics { contentDescription = description }.clickable(role = Role.Button, onClick = onClick).padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
        Text(label, fontSize = 12.sp, color = Ice, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable internal fun ErrorText(text: String) {
    if (text.isNotBlank()) Text(text, color = Color(0xFFFFC397), fontSize = 12.sp, textAlign = TextAlign.Center)
}

@Composable internal fun Field(value: String, description: String, enabled: Boolean = true, onChange: (String) -> Unit) {
    BasicTextField(value, onChange, enabled = enabled, maxLines = 4, textStyle = TextStyle(color = Color.White, fontSize = 14.sp),
        cursorBrush = androidx.compose.ui.graphics.SolidColor(Ice), modifier = Modifier.fillMaxWidth().heightIn(min = 60.dp)
            .clip(RoundedCornerShape(12.dp)).background(Panel).semantics {contentDescription = description}.padding(12.dp),
        decorationBox = { inner -> if (value.isBlank()) Text("Escribe aquí…", color = Dim, fontSize = 14.sp); inner() })
}

/** 72 points, no blur, textures, network or idle animation. Stops with activity lifecycle. */
@Composable fun Orb(state: String, active: Boolean, onTap: () -> Unit) {
    val owner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    var phase by remember { mutableFloatStateOf(0f) }
    val context = LocalContext.current
    val motion = android.provider.Settings.Global.getFloat(context.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f
    LaunchedEffect(active, motion, owner) {
        if (active && motion) owner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) { delay(50); phase += 0.025f }
        }
    }
    val color = when (state) {"attention", "error" -> Color(0xFFFFBA84); "listening" -> Color(0xFFB3F4D0); else -> Ice}
    val orbSize = (74f / LocalDensity.current.fontScale.coerceAtLeast(1f)).coerceIn(48f, 74f).dp
    Canvas(Modifier.size(orbSize).clip(CircleShape).semantics {contentDescription = "Hablar con el agente general"}
        .clickable(role = Role.Button, onClick = onTap)) {
        val radius = size.minDimension * 0.38f
        val center = Offset(size.width / 2, size.height / 2)
        drawCircle(Brush.radialGradient(listOf(color.copy(alpha = .12f), Color.Transparent), center, radius * 1.3f), radius * 1.3f, center)
        for (i in 0 until 72) {
            val y = 1f - 2f * (i + .5f) / 72f
            val r = sqrt(1f - y * y)
            val angle = i * 2.399963f + phase
            val x = cos(angle) * r; val z = sin(angle) * r
            drawCircle(color.copy(alpha = .22f + .74f * (z + 1f) / 2f), 1.0f + (z + 1f) * .6f,
                center + Offset(x * radius, y * radius))
        }
        if (active) drawArc(color.copy(alpha = .65f), phase * 70, 78f, false,
            topLeft = center - Offset(radius * 1.15f, radius * 1.15f), size = androidx.compose.ui.geometry.Size(radius * 2.3f, radius * 2.3f), style = Stroke(1.3f, cap = StrokeCap.Round))
    }
}
