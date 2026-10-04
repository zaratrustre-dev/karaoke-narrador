# Arquitectura de Narrador

## Visión general
App 100 % cliente en un único `index.html` (~2650 líneas: HTML + CSS + JS). Sin servidor; las APIs de voz se llaman directamente desde el navegador con claves del usuario (BYOK).

```
Guion ──► parseScriptWithSpeakers ──► palabras + hablante + anclas (m:ss) + sfx
                                         │
              computeBlocks (por longitud / cambio de hablante)
                                         │
Audio (subido o TTS) ─► tiempos reales o estimados (estimateSegment / interpolateFromAnchors)
                                         │
                       draw() canvas 2D: fondo + avatar + caja de karaoke
                                         │
              MediaRecorder + captureStream (+ AudioContext) ──► WebM
```

## Módulos (funciones principales en `index.html`)
| Área | Funciones |
|---|---|
| Guion y tiempos | `parseScriptWithSpeakers`, `computeBlocks`, `wordWeight`, `estimateSegment`, `interpolateFromAnchors`, `renderScriptTabs`, `extractPdfText` |
| Narración IA | `buildNarrationItems`, `applyGeneratedTimestamps`, `generateWithGemini/ElevenLabs/Azure/HfF5`, `callGeminiTts`, `callElevenLabsTts`, `callAzureTts`, `gradioUpload/gradioCall`, `encodeWav`, `sfxSilenceDuration` |
| Voces | `populate*VoiceSelect`, `refreshBrowserVoices`, `previewCharacterVoice`, `speakRunLive` |
| Onomatopeyas | `renderSfxList`, `decodeSfxFile`, `findSfxEntry`, `scheduleSfxSounds`, `triggerDueSfxSounds`, `playSfxItemLive` |
| Medios | `loadMedia`, `renderBgList`, `findCurrentBackground`, `loadCharImage`, `loadAudioFromUrl`, `clearNarrationAudio` |
| Personajes | `renderCharacterList`, `persistCharacters`, `loadPersistedCharacters` (`localStorage: karaoke_characters_v1`) |
| Render y vista previa | `draw`, `wrapWords`, `previewFullNarration`, `skipToBlock`, `currentPreviewTime` |
| Exportación | `exportWithAudioFile`, `exportWithLiveBrowserVoices`, `exportLoop`, `finalizeExport`, `addToExportHistory`, `resetExportUi` |
| UI | `setMode` (Simple/Completo vía `data-mode`) |

## Decisiones clave
1. **Un solo archivo** para poder compartirlo y abrirlo sin build.
2. **BYOK**: sin backend, el coste de TTS lo asume el usuario.
3. **Voces del navegador** no se pueden grabar directamente: la vista previa suena en vivo y solo se graba al exportar (captura de audio de pestaña con `getDisplayMedia`).
4. **Onomatopeyas** como silencios reales en el WAV generado para que no se solapen con la narración.
5. **Exportación en tiempo real**: la duración de exportación = duración del audio (limitación de MediaRecorder).
6. **F5-TTS** vía Space público de Hugging Face (`jpgallegoar/Spanish-F5`, endpoint `/infer`).
7. Los avatares no se persisten (solo nombres, colores y voces).

## Hosts externos
`generativelanguage.googleapis.com`, `api.elevenlabs.io`, Azure Speech (región configurable), Hugging Face Spaces, `fonts.googleapis.com`, `cdnjs.cloudflare.com` (pdf.js).

## Fondos anclados al guion (`[fondo: nombre]`)
`parseScriptWithSpeakers` devuelve `bgCues` (`{wordIndex, name}`) y se guarda en `state.bgCues`. La etiqueta no es una palabra: no se narra ni se subtitula. `findCurrentBackground(t)` elige el último cue cuya palabra ya tiene tiempo (`state.timestamps[wordIndex] <= t`) y cuyo nombre coincide con un fondo (`bgTag`: nombre editable o nombre de archivo, normalizado con `slugify`). Sin cues o sin coincidencia, vale el comportamiento anterior por segundos. Así las escenas siguen la narración al regenerar el audio.

## Pendiente / ideas
- Integración futura con Cogniflash (proyecto aparte).
