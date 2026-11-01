"""Inspect the exact local font, icon and brand assets without network requests."""

import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def repertoire(points):
    ranges = []
    for point in sorted(points):
        if ranges and ranges[-1][1] + 1 == point:
            ranges[-1][1] = point
        else:
            ranges.append([point, point])
    return ",".join(f"{a:X}" + (f"-{b:X}" if a != b else "") for a, b in ranges)


def font_css(records):
    return "/* Generated from the inspected local font manifest. */\n" + "\n".join(
        "@font-face {\n"
        + f'  font-family: "{record["family"]}";\n'
        + f'  src: url("../fonts/{record["file"]}") format("{"woff2" if record["file"].endswith("woff2") else "opentype"}");\n'
        + f"  font-weight: {record['weight']};\n"
        + f"  font-style: {record['style']};\n"
        + "  font-display: swap;\n"
        + (f"  unicode-range: {record['unicode_range']};\n" if "unicode_range" in record else "")
        + "}\n"
        for record in records
    )


def validate_fonts(root, locale_text=""):
    directory = root / "packages/renderer/fonts"
    records = json.loads((directory / "manifest.json").read_text())["fonts"]
    expected = {
        "IBM Plex Sans": {(400, "normal"), (400, "italic"), (500, "normal"), (600, "normal")},
        "IBM Plex Serif": {(400, "normal"), (400, "italic"), (600, "normal"), (600, "italic")},
        "IBM Plex Mono": {(400, "normal")},
        "IBM Plex Math": {(400, "normal")},
        "IBM Plex Sans KR": {(400, "normal"), (500, "normal"), (600, "normal")},
        "Noto Sans KR": {(400, "normal"), (500, "normal"), (700, "normal")},
        "Noto Serif KR": {(400, "normal"), (600, "normal")},
        "Noto Sans": {(400, "normal")},
    }
    observed = {}
    require(len({r["file"] for r in records}) == len(records), "Duplicate font file")
    require(
        {p.name for p in directory.iterdir() if p.suffix in {".woff2", ".otf", ".ttf"}}
        == {r["file"] for r in records},
        "Unmanifested or missing font",
    )
    latin = set(
        map(
            ord,
            locale_text
            + "ÀáâäåæçèéêëìíîïðñòóôöøùúûüýþÿĀāĆćČčĐđĒēĖėĘęĞğİıŁłŃńŒœŘřŚśŠšŤťŪūŽžĿŀĲĳŸẞ\u00a0\u202f\u2212\u2019₹₩",
        )
    )
    hangul = set(range(0xAC00, 0xD7A4))
    jamo = (
        set(range(0x1100, 0x1200))
        | set(range(0xA960, 0xA97D))
        | set(range(0xD7B0, 0xD7C7))
        | set(range(0xD7CB, 0xD7FC))
        | {0x302E, 0x302F}
    )
    for record in records:
        file = directory / record["file"]
        require(
            file.name == record["file"] and digest(file) == record["sha256"], "Font byte mismatch"
        )
        license_file = directory / record["license_file"]
        require(
            license_file.name == record["license_file"]
            and digest(license_file) == record["license_sha256"],
            "Font license mismatch",
        )
        require("SIL OPEN FONT LICENSE" in license_file.read_text().upper(), "Missing OFL")
        require(
            record["source"].startswith("https://")
            and (record.get("distribution") or record.get("upstream_commit")),
            "Missing upstream font identity",
        )
        with TTFont(file) as font:
            points = set(font.getBestCmap())
            versions = [name.toUnicode() for name in font["name"].names if name.nameID == 5]
            require(
                record["native_version"] in versions
                and font["OS/2"].fsType == record["fs_type"] == 0,
                "Font native version/embedding mismatch",
            )
            require(record["weight"] == font["OS/2"].usWeightClass, "Font weight mismatch")
            require(
                bool(font["head"].macStyle & 2) == (record["style"] == "italic"),
                "Font style mismatch",
            )
            require(
                repertoire(points) == record["cmap"] and len(points) == record["glyph_count"],
                "Font repertoire mismatch",
            )
            require(("MATH" in font) == record["math_table"], "MATH declaration mismatch")
            family = record["family"]
            observed.setdefault(family, []).append((record["weight"], record["style"]))
            if family in {"IBM Plex Sans", "IBM Plex Serif", "IBM Plex Mono"}:
                require(latin <= points, f"Missing Latin/locale glyph: {record['file']}")
            if family.endswith(" KR"):
                require(hangul <= points, f"Incomplete Hangul: {record['file']}")
            if family.startswith("Noto") and family.endswith(" KR"):
                require(
                    jamo <= points and len(points & set(range(0x4E00, 0xA000))) >= 8138,
                    "Incomplete Korean fallback",
                )
            if family == "IBM Plex Math":
                require(
                    "MATH" in font and {0x2211, 0x222B, 0x221A, 0x211D} <= points,
                    "Missing mathematical font data",
                )
            if family == "Noto Sans":
                require(
                    record.get("unicode_range") == "U+207F" and 0x207F in points,
                    "Unrestricted superscript fallback",
                )
    require(
        {family: set(faces) for family, faces in observed.items()} == expected
        and all(len(faces) == len(set(faces)) for faces in observed.values()),
        "Missing, duplicate or extra font faces",
    )
    require(
        (root / "packages/renderer/src/design-fonts.css").read_text() == font_css(records),
        "Font CSS drift",
    )
    return len(records)


def validate_icons(root):
    directory = root / "packages/renderer/icons"
    manifest = json.loads((directory / "manifest.json").read_text())
    require(manifest["distribution"] == "lucide-static@1.66.0", "Unexpected Lucide patch")
    require(
        digest(directory / manifest["license_file"]) == manifest["license_sha256"],
        "Icon license mismatch",
    )
    records = manifest["icons"]
    require(
        {p.name for p in directory.glob("*.svg")} == {r["file"] for r in records}
        and len({r["name"] for r in records}) == len(records),
        "Missing, duplicate or extra icon",
    )
    for record in records:
        require(
            re.fullmatch(r"[a-z0-9-]+", record["name"])
            and record["file"] == record["name"] + ".svg",
            "Invalid icon name",
        )
        file = directory / record["file"]
        require(digest(file) == record["sha256"], "Icon byte mismatch")
        svg = ET.fromstring(file.read_bytes())
        require(
            svg.attrib["viewBox"] == "0 0 24 24" and svg.attrib["stroke"] == "currentColor",
            "Unexpected Lucide geometry",
        )
        require(
            not any(
                node.tag.split("}")[-1] in {"script", "foreignObject", "image", "use"}
                for node in svg.iter()
            ),
            "Active icon content",
        )
    require(
        (root / "packages/renderer/src/design-icons.ts").read_text() == icon_module(root),
        "Icon module drift",
    )
    return len(records)


def icon_module(root):
    directory = root / "packages/renderer/icons"
    records = json.loads((directory / "manifest.json").read_text())["icons"]
    nodes = {}
    for record in records:
        svg = ET.fromstring((directory / record["file"]).read_bytes())
        shapes = []
        for node in svg:
            tag = node.tag.split("}")[-1]
            require(
                tag in {"path", "circle", "ellipse", "rect", "line", "polyline", "polygon"},
                "Unexpected icon shape",
            )
            require(
                set(node.attrib)
                <= {
                    "d",
                    "cx",
                    "cy",
                    "r",
                    "rx",
                    "ry",
                    "x",
                    "y",
                    "x1",
                    "x2",
                    "y1",
                    "y2",
                    "width",
                    "height",
                    "points",
                },
                "Unexpected icon attribute",
            )
            shapes.append([tag, node.attrib])
        nodes[record["name"]] = shapes
    return (
        "// Generated from the inspected Lucide SVG geometry.\nexport const iconNodes = "
        + json.dumps(nodes, indent=2)
        + " as const;\n"
    )


def validate_brand(root):
    directory = root / "packages/renderer/branding"
    manifest = json.loads((directory / "manifest.json").read_text())
    require(
        {r["file"] for r in manifest["files"]}
        == {"illustration.png", "illustration.svg", "symbol.svg"},
        "Incomplete branding",
    )
    for record in manifest["files"]:
        require(
            digest(directory / record["file"])
            == record["sha256"]
            == digest(root / record["source"]),
            "Brand differs from canonical asset",
        )
    png = (directory / "illustration.png").read_bytes()
    require(
        len(png) == 32224
        and hashlib.sha256(png).hexdigest()
        == "060657782a833c77461a0d099765a09b7dd397c60cc57d04d9765dc04c6fd4cb",
        "Original PNG changed",
    )
    require(
        png[16:24] == (512).to_bytes(4, "big") * 2 and png[25] == 6,
        "Original PNG dimensions/alpha changed",
    )
    return len(manifest["files"])


if __name__ == "__main__":
    if sys.argv[1:] == ["--write-font-css"]:
        fonts = json.loads((ROOT / "packages/renderer/fonts/manifest.json").read_text())["fonts"]
        (ROOT / "packages/renderer/src/design-fonts.css").write_text(font_css(fonts))
    elif sys.argv[1:] == ["--write-icon-module"]:
        (ROOT / "packages/renderer/src/design-icons.ts").write_text(icon_module(ROOT))
    else:
        print(
            json.dumps(
                {
                    "fonts": validate_fonts(ROOT, sys.stdin.buffer.read().decode("utf-8")),
                    "icons": validate_icons(ROOT),
                    "brand": validate_brand(ROOT),
                }
            )
        )
