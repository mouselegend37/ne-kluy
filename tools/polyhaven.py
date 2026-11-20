"""Poly Haven: подключение библиотеки 3D-ассетов (CC0).

Poly Haven — модели, HDR-карты и PBR-текстуры под лицензией CC0 (можно всё,
включая коммерческое использование, без указания автора). Открытое API не
требует ключа.

Команды:
    python tools/polyhaven.py search "chair"        # найти модели
    python tools/polyhaven.py hdri studio_small_09  # скачать HDRI (1k) и сделать equirect JPG
    python tools/polyhaven.py model ArmChair_01     # скачать glTF + текстуры в tools/polyhaven/models/
    python tools/polyhaven.py info ArmChair_01      # что внутри ассета

Всё складывается в tools/polyhaven/ — в сборку попадает только то, что
подключено вручную (например, src/assets/env-studio.jpg).
"""
from __future__ import annotations

import json
import pathlib
import sys
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image

API = "https://api.polyhaven.com"
UA = {"User-Agent": "ne-kluy-tools/1.0 (+https://polyhaven.com)"}
ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "polyhaven"


def api(path: str, params: dict | None = None) -> dict | list:
    url = API + path + ("?" + urllib.parse.urlencode(params) if params else "")
    request = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def download(url: str, target: pathlib.Path) -> pathlib.Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(request, timeout=180) as response, target.open("wb") as handle:
        while chunk := response.read(1 << 16):
            handle.write(chunk)
    return target


# ── Radiance .hdr → маленькая equirect-картинка ─────────────────────

def read_hdr(path: pathlib.Path) -> np.ndarray:
    """Минимальный разбор Radiance RGBE: заголовок, разрешение, RLE-сканлайны."""
    data = path.read_bytes()
    position = 0

    def line() -> str:
        nonlocal position
        end = data.index(b"\n", position)
        text = data[position:end].decode("ascii", "replace").strip()
        position = end + 1
        return text

    # заголовок идёт до пустой строки, разрешение — сразу после неё
    while line() != "":
        pass
    resolution = line().split()
    height = int(resolution[1])
    width = int(resolution[3])

    pixels = np.zeros((height, width, 4), dtype=np.float32)
    for y in range(height):
        if position + 4 <= len(data) and data[position] == 2 and data[position + 1] == 2:
            scan_width = (data[position + 2] << 8) | data[position + 3]
            position += 4
            if scan_width != width:
                raise ValueError("неподдерживаемый сканлайн")
            channels = np.zeros((4, width), dtype=np.uint8)
            for channel in range(4):
                x = 0
                while x < width:
                    count = data[position]
                    position += 1
                    if count > 128:
                        value = data[position]
                        position += 1
                        channels[channel, x : x + count - 128] = value
                        x += count - 128
                    else:
                        channels[channel, x : x + count] = np.frombuffer(
                            data[position : position + count], dtype=np.uint8
                        )
                        position += count
                        x += count
            pixels[y] = channels.T
        else:
            raw = np.frombuffer(data[position : position + width * 4], dtype=np.uint8)
            position += width * 4
            pixels[y] = raw.reshape(width, 4).astype(np.float32)

    scale = np.exp2(pixels[..., 3] - 128.0).astype(np.float32) / 256.0
    rgb = pixels[..., :3] * scale[..., None]
    return rgb


def hdr_to_equirect(source: pathlib.Path, target: pathlib.Path, width: int = 512, exposure: float = 1.0) -> None:
    rgb = read_hdr(source)
    rgb = rgb * exposure
    # Рейнхард + гамма: получается LDR-картинка, пригодная как карта окружения
    rgb = rgb / (1.0 + rgb)
    rgb = np.clip(rgb, 0, 1) ** (1 / 2.2)
    image = Image.fromarray((rgb * 255).astype(np.uint8), "RGB")
    image = image.resize((width, width // 2), Image.LANCZOS)
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target, quality=90, optimize=True)


# ── команды ─────────────────────────────────────────────────────────

def cmd_search(query: str) -> None:
    assets = api("/assets", {"t": "models"})
    hits = [
        (slug, data["name"], ", ".join(data.get("categories", [])[:3]))
        for slug, data in assets.items()
        if query.lower() in slug.lower() or query.lower() in data["name"].lower()
    ]
    print(f"моделей всего: {len(assets)}; найдено: {len(hits)}")
    for slug, name, categories in hits[:25]:
        print(f"  {slug:32} {name:34} {categories}")


def cmd_info(slug: str) -> None:
    files = api(f"/files/{slug}")
    print(f"{slug}: {', '.join(k for k in files if not k.startswith('renders'))}")
    gltf = files.get("gltf", {})
    for res in ("1k", "2k"):
        if res in gltf:
            print(f"  gltf {res}:", ", ".join(gltf[res].keys()))
            break


def cmd_model(slug: str) -> None:
    files = api(f"/files/{slug}")
    gltf = files.get("gltf") or files.get("glb")
    if not gltf:
        raise SystemExit("у ассета нет glTF-версии")
    resolution = "1k" if "1k" in gltf else next(iter(gltf))
    bundle = gltf[resolution]
    target_dir = OUT / "models" / slug
    for name, info in bundle.items():
        if name != "gltf":
            continue
        main = download(info["url"], target_dir / pathlib.Path(info["url"]).name)
        print("скачано:", main.relative_to(ROOT))
        # include: текстуры и .bin, которые лежат рядом
        payload = info.get("include", {})
        for key, resource in payload.items():
            path = resource["url"]
            download(path, target_dir / pathlib.Path(path).name)
            print("  +", pathlib.Path(path).name)
        break


def cmd_hdri(slug: str) -> None:
    files = api(f"/files/{slug}")
    entry = files["hdri"]["1k"]["hdr"]
    raw = download(entry["url"], OUT / "hdri" / f"{slug}_1k.hdr")
    print("скачано:", raw.relative_to(ROOT), f"{raw.stat().st_size / 1e6:.1f} МБ")
    jpg = OUT / "hdri" / f"{slug}_equirect.jpg"
    hdr_to_equirect(raw, jpg)
    print("equirect:", jpg.relative_to(ROOT), f"{jpg.stat().st_size / 1024:.0f} КБ", Image.open(jpg).size)


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        return
    command, *rest = sys.argv[1:]
    if command == "search":
        cmd_search(" ".join(rest))
    elif command == "info":
        cmd_info(rest[0])
    elif command == "model":
        cmd_model(rest[0])
    elif command == "hdri":
        cmd_hdri(rest[0])
    else:
        print(__doc__)


if __name__ == "__main__":
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")
    main()
