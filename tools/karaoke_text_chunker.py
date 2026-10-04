"""
karaoke_text_chunker.py
========================
Troceo de guion para subtítulos karaoke — versión Python independiente.

No depende de ningún servicio de IA: toma un guion de texto (con etiquetas
"Nombre: texto" y, opcionalmente, marcas de tiempo "(mm:ss)" o "(h:mm:ss)")
y calcula:

  1. la lista de palabras con su hablante,
  2. los bloques de subtítulo (se cortan por longitud o cambio de hablante),
  3. una estimación del tiempo de cada palabra, ya sea repartiendo una
     duración total de forma pareja, o interpolando entre marcas de tiempo
     reales detectadas en el texto.

Uso típico:

    from karaoke_text_chunker import parse_script, compute_blocks, estimate_segment

    words, anchors = parse_script(texto, personajes_conocidos={"narrador", "gu"})
    blocks = compute_blocks(words, limit=70)
    timestamps = interpolate_from_anchors(words, anchors, audio_duration=42.0)
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
import re
import unicodedata


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------

def slugify(name: str) -> str:
    """Normaliza un nombre de personaje a un identificador simple."""
    name = name.strip().lower()
    name = unicodedata.normalize("NFD", name)
    name = "".join(c for c in name if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", "-", name)


def parse_time_token(token: str) -> float:
    """Convierte 'mm:ss' o 'h:mm:ss' a segundos."""
    parts = [int(p) for p in token.split(":")]
    if len(parts) == 3:
        h, m, s = parts
        return h * 3600 + m * 60 + s
    m, s = parts
    return m * 60 + s


@dataclass
class Word:
    text: str
    speaker: str


@dataclass
class Anchor:
    word_index: int
    time: float


_TAG_RE = re.compile(r"^\s*([^:\n]{1,30}):\s*(.*)$")
_ANCHOR_RE = re.compile(r"\(\s*((?:\d+:)?\d{1,2}:\d{2})\s*\)")


# ---------------------------------------------------------------------------
# 1. Parseo del guion: palabras + hablante + marcas de tiempo detectadas
# ---------------------------------------------------------------------------

def parse_script(text: str, known_characters: Optional[set[str]] = None) -> tuple[list[Word], list[Anchor]]:
    """
    Divide el guion en palabras, asignando el hablante actual a cada una,
    y extrae cualquier marca de tiempo "(mm:ss)" como ancla.

    known_characters: conjunto de ids (slugify) de personajes reconocidos.
    Si una línea empieza con "Nombre:" y ese nombre no está en el conjunto,
    se trata como texto normal (no como cambio de hablante) — igual que en
    el editor. Si no se pasa el conjunto, cualquier "Nombre:" se acepta.
    """
    words: list[Word] = []
    anchors: list[Anchor] = []
    current_speaker = "narrador"
    pending_anchor_time: Optional[float] = None

    def push_words(chunk: str):
        nonlocal pending_anchor_time
        for w in chunk.strip().split():
            if pending_anchor_time is not None:
                anchors.append(Anchor(word_index=len(words), time=pending_anchor_time))
                pending_anchor_time = None
            words.append(Word(text=w, speaker=current_speaker))

    for line in text.splitlines():
        if not line.strip():
            continue
        content = line
        m = _TAG_RE.match(line)
        if m:
            candidate_id = slugify(m.group(1))
            if known_characters is None or candidate_id in known_characters:
                current_speaker = candidate_id
                content = m.group(2)

        last_index = 0
        for match in _ANCHOR_RE.finditer(content):
            push_words(content[last_index:match.start()])
            pending_anchor_time = parse_time_token(match.group(1))
            last_index = match.end()
        push_words(content[last_index:])

    return words, anchors


# ---------------------------------------------------------------------------
# 2. Bloques de subtítulo (se cortan por longitud o cambio de hablante)
# ---------------------------------------------------------------------------

@dataclass
class Block:
    start: int
    end: int  # inclusive


def compute_blocks(words: list[Word], limit: int = 70) -> list[Block]:
    blocks: list[Block] = []
    start = 0
    length = 0
    for i, word in enumerate(words):
        w_len = len(word.text) + 1
        speaker_changed = i > start and word.speaker != words[i - 1].speaker
        if (length + w_len > limit or speaker_changed) and i > start:
            blocks.append(Block(start, i - 1))
            start = i
            length = 0
        length += w_len
    if start <= len(words) - 1:
        blocks.append(Block(start, len(words) - 1))
    return blocks


# ---------------------------------------------------------------------------
# 3. Estimación de tiempos por palabra
# ---------------------------------------------------------------------------

def word_weight(text: str) -> float:
    """Peso relativo de una palabra: más letras y puntuación = más tiempo."""
    weight = len(text) + 1
    if re.search(r"[.!?…]$", text):
        weight += 4  # pausa larga
    elif re.search(r"[,;:]$", text):
        weight += 2  # pausa corta
    return weight


def estimate_segment(words: list[Word], start_idx: int, end_idx: int,
                      start_time: float, end_time: float,
                      out: list[Optional[float]]) -> None:
    """Reparte proporcionalmente el tiempo entre start_time y end_time
    para las palabras [start_idx, end_idx], escribiendo en `out` (in-place)."""
    if start_idx > end_idx:
        return
    segment = words[start_idx:end_idx + 1]
    weights = [word_weight(w.text) for w in segment]
    total = sum(weights) or 1
    cumulative = 0.0
    for i, w in enumerate(weights):
        out[start_idx + i] = start_time + (cumulative / total) * (end_time - start_time)
        cumulative += w


def interpolate_from_anchors(words: list[Word], anchors: list[Anchor],
                              audio_duration: Optional[float] = None) -> list[Optional[float]]:
    """Calcula el tiempo estimado de cada palabra usando las marcas de
    tiempo detectadas como puntos de control exactos, interpolando el
    resto según la longitud de las palabras."""
    out: list[Optional[float]] = [None] * len(words)
    if not anchors:
        return out

    sorted_anchors = sorted(anchors, key=lambda a: a.word_index)

    # ritmo promedio (peso por segundo) entre anclas, para extrapolar extremos
    pace_weight = 0.0
    pace_time = 0.0
    for a, b in zip(sorted_anchors, sorted_anchors[1:]):
        pace_weight += sum(word_weight(w.text) for w in words[a.word_index:b.word_index])
        pace_time += (b.time - a.time)
    pace = (pace_weight / pace_time) if pace_time > 0 else None

    first = sorted_anchors[0]
    if first.word_index > 0:
        lead_weight = sum(word_weight(w.text) for w in words[:first.word_index])
        lead_duration = (lead_weight / pace) if pace else first.time
        estimate_segment(words, 0, first.word_index - 1, max(0.0, first.time - lead_duration), first.time, out)

    for a, b in zip(sorted_anchors, sorted_anchors[1:]):
        out[a.word_index] = a.time
        estimate_segment(words, a.word_index + 1, b.word_index - 1, a.time, b.time, out)
        out[b.word_index] = b.time
    out[first.word_index] = first.time

    last = sorted_anchors[-1]
    if last.word_index < len(words) - 1:
        tail_weight = sum(word_weight(w.text) for w in words[last.word_index + 1:])
        if audio_duration:
            end_time = audio_duration
        elif pace:
            end_time = last.time + tail_weight / pace
        else:
            end_time = last.time + tail_weight * 0.08
        estimate_segment(words, last.word_index + 1, len(words) - 1, last.time, end_time, out)

    return out


def estimate_evenly(words: list[Word], duration: float) -> list[float]:
    """Modo 'automático' sin marcas: reparte toda la duración de forma pareja."""
    out: list[Optional[float]] = [None] * len(words)
    estimate_segment(words, 0, len(words) - 1, 0.0, duration, out)
    return out  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Ejemplo de uso
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    guion = """Narrador: (0:00) Compañero. Regresión infinita. Un cierto género lleva ese nombre.
Se llama, Regresión infinita, cuando el protagonista muere y regresa. (0:15) Naturalmente, el protagonista lo supera."""

    words, anchors = parse_script(guion, known_characters={"narrador"})
    blocks = compute_blocks(words, limit=70)
    timestamps = interpolate_from_anchors(words, anchors, audio_duration=20.0)

    print(f"{len(words)} palabras, {len(blocks)} bloques, {len(anchors)} anclas detectadas\n")
    for block in blocks:
        text = " ".join(w.text for w in words[block.start:block.end + 1])
        t0 = timestamps[block.start]
        print(f"[{t0:5.2f}s] {text}")
