"""Build the extension's card content for the card host (R2 behind cards.atlas-conquest.com).

Everything the viewer's browser fetches at runtime, other than the bundle Twitch
hosts, comes from here:

    cdn-out/twitch/cards.json              card data, deck code table, tile art (short cache)
    cdn-out/twitch/i18n/<locale>.json      that language's card names, art files, keyword
                                           reminders and tile names/text
    cdn-out/twitch/<locale>/<card>.<hash>.webp   600x840 render (cached forever)
    cdn-out/twitch/tiles/<tile>.<hash>.webp      tile art (cached forever)
    cdn-out/twitch/artwork/<card>.<hash>.webp    the illustration alone, for history rows
    cdn-out/twitch/abilities/<key>.<hash>.webp   activated ability icons (history row badge)

Art filenames carry a hash of their bytes, so they are served `immutable` and a
viewer downloads each card once; a re-rendered card gets a new name, and the
short-lived i18n file is what points at it. Unchanged cards keep their name, so
re-running after one card changes uploads one file per language.

Inputs, from the game repo beside this one (the workspace layout):
    CardScreenshots/<code>/<card>.png          renders, one folder per language
    atlas-conquest/Assets/Resources/Localization/<code>.json   shipped translations
    TwitchExport/cards.json, i18n/<code>.json, tiles/, artwork/, abilities/   TwitchCardExporter
                                               (tools/twitch-export.sh in the game repo)

    python scripts/build_cdn.py                 # every language
    python scripts/build_cdn.py --only de,ja    # some (cards.json is always written)
    then: scripts/upload_cdn.sh
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
GAME = REPO.parent / "atlas-conquest"

# Game locale codes, in the game's own order. Folders on the host are lowercase,
# matching the website's localized card folders in the same bucket.
LOCALES = ["en", "de", "es-419", "fr", "it", "ja", "ko", "pl", "pt-BR", "ru", "zh-CN"]

# Source renders are 800x1120. One 600px WebP serves both the hover panel and the
# pinned view on a high-DPI screen, so a viewer fetches each card at most once.
WIDTH = 600
QUALITY = 80


def folder(code: str) -> str:
    return code.lower()


def encode(src: Path) -> bytes:
    img = Image.open(src).convert("RGBA")
    img = img.resize((WIDTH, round(img.height * WIDTH / img.width)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=QUALITY, method=6)
    return buf.getvalue()


def build_one(job: tuple[str, str, str]) -> tuple[str, str, str | None]:
    """(card id, render path, out dir) -> (card id, relative art path, error)."""
    card_id, src, out_dir = job
    src_p, out_p = Path(src), Path(out_dir)
    try:
        # Hash the source, not the output: WebP encoding is deterministic here,
        # but hashing the input lets an unchanged card skip the encode entirely.
        digest = hashlib.sha256(src_p.read_bytes()).hexdigest()[:10]
        name = f"{src_p.stem}.{digest}.webp"
        dest = out_p / name
        if not dest.exists():
            dest.write_bytes(encode(src_p))
        return card_id, f"{out_p.name}/{name}", None
    except Exception as e:  # one bad render must not sink the whole language
        return card_id, "", f"{src_p}: {e}"


# History rows are small squares; 160px covers them on a high-DPI screen.
ARTWORK = 160
# Ability glyphs are drawn as a mask in a small badge.
ICON = 64


def encode_square(job: tuple[str, str, int]) -> tuple[str, str, str | None]:
    """(png path, out dir, size) -> (stem, relative path, error). Hashed like the renders."""
    src, out_dir, size = job
    src_p, out_p = Path(src), Path(out_dir)
    try:
        digest = hashlib.sha256(src_p.read_bytes()).hexdigest()[:10]
        dest = out_p / f"{src_p.stem}.{digest}.webp"
        if not dest.exists():
            img = Image.open(src_p).convert("RGBA")
            img.thumbnail((size, size), Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, "WEBP", quality=QUALITY, method=6)
            dest.write_bytes(buf.getvalue())
        return src_p.stem, f"{out_p.name}/{dest.name}", None
    except Exception as e:
        return src_p.stem, "", f"{src_p}: {e}"


def encode_folder(pool, src_dir: Path, out_dir: Path, size: int) -> dict[str, str]:
    """Every PNG in src_dir -> {stem: relative path}."""
    out_dir.mkdir(exist_ok=True)
    jobs = [(str(p), str(out_dir), size) for p in sorted(src_dir.glob("*.png"))] if src_dir.exists() else []
    result = {}
    for stem, rel, err in pool.map(encode_square, jobs, chunksize=8):
        if err:
            print(f"  !! {err}", file=sys.stderr)
        else:
            result[stem] = rel
    return result


def card_names(code: str, cards: list[dict]) -> dict[str, str]:
    """Wire id -> localized name. Missing entries fall back to English at runtime."""
    if code == "en":
        return {str(c["id"]): c["name"] for c in cards}
    table_path = GAME / "atlas-conquest" / "Assets" / "Resources" / "Localization" / f"{code}.json"
    table = json.loads(table_path.read_text(encoding="utf-8"))
    by_src = {v["src"]: v["text"] for v in table.values()
              if isinstance(v, dict) and v.get("kind") == "card-name" and v.get("text")}
    return {str(c["id"]): by_src[c["name"]] for c in cards if c["name"] in by_src}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--only", default="", help="comma list of locale codes")
    ap.add_argument("--export", type=Path, default=GAME / "TwitchExport",
                    help="TwitchCardExporter output folder (cards.json, i18n/, tiles/)")
    ap.add_argument("--out", type=Path, default=REPO / "cdn-out" / "twitch")
    args = ap.parse_args(argv)

    locales = [c for c in LOCALES if not args.only or c in args.only.split(",")]
    payload = json.loads((args.export / "cards.json").read_text(encoding="utf-8"))
    cards = payload["cards"]
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "i18n").mkdir(exist_ok=True)

    # Art no longer lives beside cards.json, so the old per-card stem is dropped
    # from the contract: the i18n file names each file outright.
    payload["version"] = 2
    payload["locales"] = LOCALES
    payload.pop("artExtension", None)

    # Tile art, for the tiles cards name (a lava field, a village). Hashed like card art.
    tile_dir = args.out / "tiles"
    tile_dir.mkdir(exist_ok=True)
    tile_art = {}
    for png in sorted((args.export / "tiles").glob("*.png")):
        digest = hashlib.sha256(png.read_bytes()).hexdigest()[:10]
        dest = tile_dir / f"{png.stem}.{digest}.webp"
        if not dest.exists():
            img = Image.open(png).convert("RGBA")
            buf = io.BytesIO()
            img.save(buf, "WEBP", quality=QUALITY, method=6)
            dest.write_bytes(buf.getvalue())
        tile_art[png.stem] = f"tiles/{dest.name}"
    payload["tileArt"] = tile_art

    failed = 0
    with ProcessPoolExecutor() as pool:
        # The illustration alone, for history rows: wire id -> path. Not per language.
        artwork = encode_folder(pool, args.export / "artwork", args.out / "artwork", ARTWORK)
        payload["artwork"] = {str(c["id"]): artwork[c["art"]] for c in cards if c["art"] in artwork}
        # Activated abilities: wire id -> icon and stamp colours. Names and text are per language.
        icons = encode_folder(pool, args.export / "abilities", args.out / "abilities", ICON)
        payload["abilities"] = {
            str(a["id"]): {"bg": a["bg"], "fg": a["fg"], **({"icon": icons[a["key"]]} if a["key"] in icons else {})}
            for a in payload.get("abilities", [])
        }
        print(f"  artwork: {len(payload['artwork'])}/{len(cards)} cards; "
              f"abilities: {len(payload['abilities'])} ({len(icons)} icons)")

        (args.out / "cards.json").write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

        for code in locales:
            src_dir = GAME / "CardScreenshots" / code
            out_dir = args.out / folder(code)
            out_dir.mkdir(exist_ok=True)

            jobs, missing = [], []
            for c in cards:
                src = src_dir / f"{c['art']}.png"
                if src.exists():
                    jobs.append((str(c["id"]), str(src), str(out_dir)))
                else:
                    missing.append(c["name"])

            art = {}
            for card_id, rel, err in pool.map(build_one, jobs, chunksize=8):
                if err:
                    failed += 1
                    print(f"  !! {err}", file=sys.stderr)
                else:
                    art[card_id] = rel

            names = card_names(code, cards)
            # Keyword reminders and tile text, rendered by the game per language. A missing
            # file (an older export) leaves them out; the viewer falls back to English.
            game_locale = args.export / "i18n" / f"{code}.json"
            extra = json.loads(game_locale.read_text(encoding="utf-8")) if game_locale.exists() else {}
            (args.out / "i18n" / f"{folder(code)}.json").write_text(
                json.dumps({"names": names, "art": art,
                            "reminders": extra.get("reminders", {}), "tiles": extra.get("tiles", {}),
                            "abilities": extra.get("abilities", {}), "short": extra.get("short", {})},
                           ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8")
            print(f"  {code}: {len(art)} renders, {len(names)} names, "
                  f"{len(extra.get('reminders', {}))} reminders, {len(extra.get('tiles', {}))} tiles"
                  + (f"; no render for {len(missing)}: {', '.join(missing[:6])}" if missing else ""))

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
