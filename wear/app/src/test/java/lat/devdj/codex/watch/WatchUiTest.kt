package lat.devdj.codex.watch

import org.junit.Assert.*
import org.junit.Test

class WatchUiTest {
    @Test fun statusReflectsActualLifecycleWithoutProviderOrFakeProgress() {
        assertEquals("Aquí estoy", WatchUi().label)
        assertEquals("Estoy en ello", WatchUi(state = "working").label)
        assertEquals("Leyendo", WatchUi(state = "working", activity = "Leyendo").label)
        assertEquals("Necesito tu atención", WatchUi(state = "attention").label)
        assertEquals("Sin actualizar", WatchUi(state = "working", error = "sin red").label)
        assertFalse(WatchUi(state = "idle").working)
        assertTrue(WatchUi(state = "queued").working)
    }

    @Test fun quotaLevelsWarnBeforeAnAgentRunsDry() {
        assertEquals(Level.Good, levelOf(100))
        assertEquals(Level.Good, levelOf(40))
        assertEquals(Level.Warn, levelOf(39))
        assertEquals(Level.Warn, levelOf(15))
        assertEquals(Level.Low, levelOf(14))
        assertEquals(Level.Low, levelOf(0))
        assertEquals(Level.Good, levelOf(null))
    }

    @Test fun windowsReportWhatIsLeftAndTellFiveHoursFromWeekly() {
        val quota = ProviderQuota(listOf(QuotaWindow(10080, 61.6, 0), QuotaWindow(300, 28.0, 0)))
        assertEquals(72, quota.session?.left)
        assertEquals(38, quota.weekly?.left)
        assertEquals(72, quota.left)
        assertEquals(0, QuotaWindow(300, 140.0, 0).left)
        assertEquals(100, QuotaWindow(300, -5.0, 0).left)
        assertNull(ProviderQuota(listOf(QuotaWindow(300, 10.0, 0))).weekly)
    }

    @Test fun theHintPicksTheAgentWithMoreLeft() {
        val low = ProviderQuota(listOf(QuotaWindow(300, 80.0, 0)))
        val high = ProviderQuota(listOf(QuotaWindow(300, 10.0, 0)))
        assertEquals("Codex", bestAgent(low, high))
        assertEquals("Claude", bestAgent(high, low))
        assertEquals("Claude", bestAgent(high, null))
        assertEquals("Codex", bestAgent(null, high))
        assertNull(bestAgent(null, null))
    }

    @Test fun agesReadInPlainSpanish() {
        assertEquals("", ago(0, 1000))
        assertEquals("ahora", ago(990, 1000))
        assertEquals("hace 5 min", ago(700, 1000))
        assertEquals("hace 2 h", ago(10000 - 7300, 10000))
        assertEquals("hace 3 d", ago(1000, 1000 + 3 * 86400 + 10))
    }

    @Test fun theStatusFollowsTheVoiceTurn() {
        assertEquals("Te escucho", WatchUi(listening = true, state = "working").label)
        assertEquals("Enviando", WatchUi(busy = true).label)
        assertEquals("Ok, buscando.", WatchUi(state = "queued", ack = "Ok, buscando.").label)
        assertEquals("En cola · 2 antes", WatchUi(state = "queued", ack = "Ok, buscando.", ahead = 2).label)
        assertEquals("Ok, buscando.", WatchUi(state = "working", ack = "Ok, buscando.").label)
        assertEquals("Revisando contenedores", WatchUi(state = "working", ack = "Ok, buscando.", activity = "Revisando contenedores").label)
    }

    @Test fun theInstantReplyFitsWhatWasAsked() {
        assertEquals("Ok, buscando.", ack("¿Cómo va la tienda?", 0))
        assertEquals("Déjame ver.", ack("qué contenedores están caídos", 1))
        assertEquals("Va, me pongo con eso.", ack("Despliega alpha", 0))
        assertEquals("Ok, en eso estoy.", ack("Corrige el formulario", 4))
        assertEquals("", ack("Hola", 0))
        assertEquals("", ack("gracias, perfecto", 2))
        assertEquals("", ack("   ", 0))
    }

    @Test fun sentencesAreReadOnlyOnceTheyAreFinished() {
        assertEquals(-1, sentenceEnd("Va, reviso", 0))
        assertEquals(-1, sentenceEnd("Cuesta 3.", 0))
        assertEquals(11, sentenceEnd("Va, reviso. Ya", 0))
        assertEquals(30, sentenceEnd("Va, reviso. Hay 3.5 GB libres. ", 0))
        assertEquals(-1, sentenceEnd("Va, reviso. Ya", 11))
        assertEquals(6, sentenceEnd("Listo\n\nTodo", 0))
        assertEquals("Hay 3.5 GB libres.", lastSentence("Va, reviso. Hay 3.5 GB libres."))
        assertEquals("Todo bien", lastSentence("Uno.\nTodo bien"))
        assertEquals("", lastSentence("  "))
    }

    @Test fun theVoiceReadsPlainSpanish() {
        assertEquals("Mira el enlace ahora", spoken("Mira **https://alpha.example.com/x** ahora"))
        assertEquals("Listo", spoken("Listo 🚀"))
        assertEquals(600, spoken("a".repeat(900)).length)
        assertTrue(voiceScore("MX", 400, false) > voiceScore("ES", 500, false))
        assertTrue(voiceScore("US", 400, false) > voiceScore("US", 400, true))
        assertTrue(voiceScore("MX", 500, true) > voiceScore("MX", 300, false))
        assertEquals("es-MX", spanishTag(java.util.Locale.US))
        assertEquals("es-AR", spanishTag(java.util.Locale.forLanguageTag("es-AR")))
        assertEquals("es-MX", spanishTag(java.util.Locale.forLanguageTag("es")))
    }

    @Test fun noticesSayWhereTheyCameFrom() {
        assertEquals("Agente", Notice("terminado", "_general", "x", 0, "claude").where)
        assertEquals("alpha", Notice("error", "alpha", "x", 0, "codex").where)
        assertTrue(Notice("approval", "", "x", 0, "").general)
    }
}
