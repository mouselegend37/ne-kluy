"""Перебор голосов на одной фразе: генерирует MP3 и печатает длительность.

    python tools/voice-try.py                 # все кандидаты на фразе hello
    python tools/voice-try.py --line pressure # более длинная фраза — слышно интонацию

Результат — tools/voice-sample/try-<голос>.mp3
"""
import argparse
import asyncio
import pathlib
import sys

import edge_tts

CANDIDATES = [
    "ru-RU-DmitryNeural",                    # текущий на сайте
    "en-US-AndrewMultilingualNeural",        # warm, confident
    "en-US-BrianMultilingualNeural",         # approachable, casual
    "en-US-AvaMultilingualNeural",           # expressive
    "en-US-EmmaMultilingualNeural",          # conversational
    "fr-FR-RemyMultilingualNeural",
    "ru-RU-SvetlanaNeural",
]

LINES = {
    "hello": "Здравствуйте! Это оператор сотовой связи. Вы меня нормально слышите?",
    "pressure": "Если не назовёте код — номер заблокируют и внесут в чёрный список, "
                "восстановить будет нельзя. Через десять минут будет поздно.",
}

OUT = pathlib.Path(__file__).resolve().parent / "voice-sample"


async def speak(voice: str, text: str, target: pathlib.Path) -> int:
    for _ in range(6):
        try:
            communicate = edge_tts.Communicate(text, voice, rate="+4%")
            data = b""
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    data += chunk["data"]
            if data:
                target.write_bytes(data)
                return len(data)
        except Exception:
            pass
        await asyncio.sleep(2)
    return 0


def duration(path: pathlib.Path) -> float:
    """Длительность MP3 без внешних утилит: считаем кадры 44.1 кГц 48 кбит/с."""
    size = path.stat().st_size
    return round(size * 8 / 48000, 2)


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--line", default="hello", choices=list(LINES))
    args = parser.parse_args()
    OUT.mkdir(exist_ok=True)
    for voice in CANDIDATES:
        name = voice.replace("Neural", "")
        target = OUT / f"try-{name}-{args.line}.mp3"
        size = await speak(voice, LINES[args.line], target)
        print(f"{voice:38} {'ок' if size else 'НЕ ПОЛУЧИЛОСЬ':16} {size:7} байт  ~{duration(target) if size else 0} с", flush=True)


if __name__ == "__main__":
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
