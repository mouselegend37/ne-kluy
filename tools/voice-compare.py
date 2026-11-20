"""Сравнение голосовых движков на одной фразе.

Собирает tools/voice-sample/*.mp3 из трёх вариантов:
  edge — Microsoft Neural (edge-tts, нужен интернет, без ключа);
  piper-dmitri / piper-irina — Piper (локально, MIT, модели в tools/voices).
"""
import asyncio
import pathlib
import sys
import wave

import lameenc

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "voice-sample"
TEXT = "Здравствуйте! Это оператор сотовой связи. Вы меня нормально слышите?"


def wav_to_mp3(wav_path: pathlib.Path, mp3_path: pathlib.Path) -> int:
    with wave.open(str(wav_path), "rb") as src:
        channels = src.getnchannels()
        rate = src.getframerate()
        frames = src.readframes(src.getnframes())
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(48)
    encoder.set_in_sample_rate(rate)
    encoder.set_channels(channels)
    encoder.set_quality(7)
    data = encoder.encode(frames) + encoder.flush()
    mp3_path.write_bytes(data)
    return len(data)


async def edge_tts_line(target: pathlib.Path) -> None:
    import edge_tts

    for _ in range(6):
        try:
            communicate = edge_tts.Communicate(TEXT, "ru-RU-DmitryNeural", rate="+4%")
            data = b""
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    data += chunk["data"]
            if data:
                target.write_bytes(data)
                return
        except Exception:  # noqa: BLE001
            pass
        await asyncio.sleep(2)
    print("edge: не удалось")


def piper_line(voice: str, wav: pathlib.Path) -> bool:
    import subprocess

    model = ROOT / "voices" / f"{voice}.onnx"
    result = subprocess.run(
        [sys.executable, "-m", "piper", "-m", str(model), "-f", str(wav), "--", TEXT],
        capture_output=True,
    )
    return result.returncode == 0 and wav.exists()


def main() -> None:
    OUT.mkdir(exist_ok=True)
    edge = OUT / "edge-dmitry.mp3"
    if not edge.exists():
        asyncio.run(edge_tts_line(edge))
    print("edge:", edge.stat().st_size if edge.exists() else "нет")

    for voice in ("ru_RU-dmitri-medium", "ru_RU-irina-medium"):
        wav = OUT / f"{voice}.wav"
        if piper_line(voice, wav):
            size = wav_to_mp3(wav, OUT / f"{voice}.mp3")
            wav.unlink(missing_ok=True)
            print(f"{voice}: {size} bytes")
        else:
            print(f"{voice}: не удалось")


if __name__ == "__main__":
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")
    main()
