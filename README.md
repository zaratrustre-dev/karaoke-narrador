# Narrador — editor de karaoke para audiolibros

Herramienta web de **un solo archivo** (`index.html`, sin backend ni build) para crear vídeos narrados con subtítulos tipo karaoke: fondos, personajes, voces TTS, onomatopeyas y exportación a WebM.

## Uso
Abre `index.html` en Chrome/Edge (o sirve la carpeta con `python3 -m http.server`). No requiere instalación.

## Funciones
- Modo **Simple** (fondos, personaje, audio narrado, guion) y **Completo** (+ personajes múltiples, narración con IA, búsqueda de voces).
- Guion con `Nombre: texto`, marcas de tiempo `(m:ss)` y onomatopeyas `*boom*`.
- Fondos anclados al guion con `[fondo: nombre]`: cambian cuando se narra esa palabra.
- Fondos y avatares con imagen, GIF o vídeo corto.
- Voces TTS (traes tu propia clave): Gemini, ElevenLabs, Azure, F5-TTS (Hugging Face Space) y voces del navegador.
- Transcripción con Gemini con diferenciación de oradores.
- Exportación WebM con historial, cancelación y descarga solo de audio.

## Claves API
Las claves se escriben en la interfaz y **nunca** se guardan en el repositorio. Solo se persisten en `localStorage` los personajes (nombre, color, voces).

## Estructura
- `index.html` — la aplicación completa
- `tools/` — troceadores de texto independientes (Python y JS)
- `ARCHITECTURE.md` — arquitectura y decisiones
- `CONTEXT.md` — estado del proyecto y pendientes
