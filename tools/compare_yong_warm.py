#!/usr/bin/env python3
"""Compare Yong renderings using only warm red ink pixels.

This is stricter than compare_yong.py for the current reference frame because
the video still contains dark hand/background regions and red guide lines. The
warm mask keeps the red character ink and rejects most grid/background pixels.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps


def parse_box(value: str) -> tuple[int, int, int, int]:
    parts = [int(part) for part in value.split(",")]
    if len(parts) != 4:
        raise ValueError(f"box must be left,top,right,bottom: {value}")
    return tuple(parts)  # type: ignore[return-value]


def warm_mask(image: Image.Image) -> Image.Image:
    rgb = image.convert("RGB")
    out = Image.new("L", rgb.size, 0)
    src = rgb.load()
    dst = out.load()
    width, height = rgb.size
    for y in range(height):
        for x in range(width):
            r, g, b = src[x, y]
            warm_ink = r > 78 and r > g * 1.18 and r > b * 1.25 and (r - min(g, b)) > 34 and g < 125 and b < 115
            if warm_ink:
                dst[x, y] = 255
    return out.filter(ImageFilter.MedianFilter(3))


def normalize_mask(mask: Image.Image, size: int, padding: int) -> Image.Image:
    bbox = mask.getbbox()
    out = Image.new("L", (size, size), 0)
    if not bbox:
        return out
    cropped = mask.crop(bbox)
    cropped.thumbnail((size - padding * 2, size - padding * 2), Image.Resampling.LANCZOS)
    out.paste(cropped, ((size - cropped.width) // 2, (size - cropped.height) // 2))
    return out.point(lambda value: 255 if value > 60 else 0)


def mask_stats(mask: Image.Image) -> tuple[int, tuple[int, int, int, int], tuple[float, float], float]:
    pixels = mask.load()
    area = 0
    sx = 0
    sy = 0
    for y in range(mask.height):
        for x in range(mask.width):
            if pixels[x, y] > 0:
                area += 1
                sx += x
                sy += y
    bbox = mask.getbbox() or (0, 0, 1, 1)
    centroid = (sx / area, sy / area) if area else (0.0, 0.0)
    aspect = (bbox[2] - bbox[0]) / max(1, bbox[3] - bbox[1])
    return area, bbox, centroid, aspect


def overlay_masks(ref_mask: Image.Image, cand_mask: Image.Image) -> Image.Image:
    out = Image.new("RGB", ref_mask.size, "white")
    ref = ref_mask.load()
    cand = cand_mask.load()
    dst = out.load()
    for y in range(ref_mask.height):
        for x in range(ref_mask.width):
            r = ref[x, y] > 0
            c = cand[x, y] > 0
            if r and c:
                dst[x, y] = (36, 120, 60)
            elif r:
                dst[x, y] = (220, 60, 55)
            elif c:
                dst[x, y] = (45, 95, 220)
    return out


def mask_iou(ref_mask: Image.Image, cand_mask: Image.Image) -> float:
    ref = ref_mask.load()
    cand = cand_mask.load()
    inter = 0
    union = 0
    for y in range(ref_mask.height):
        for x in range(ref_mask.width):
            r = ref[x, y] > 0
            c = cand[x, y] > 0
            if r and c:
                inter += 1
            if r or c:
                union += 1
    return inter / union if union else 0.0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", required=True)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--ref-box", required=True)
    parser.add_argument("--cand-box", required=True)
    parser.add_argument("--label", default="warm-compare")
    parser.add_argument("--size", type=int, default=260)
    parser.add_argument("--padding", type=int, default=24)
    parser.add_argument("--out", required=True)
    parser.add_argument("--json-out")
    args = parser.parse_args()

    reference = Image.open(args.reference).convert("RGB").crop(parse_box(args.ref_box))
    candidate = Image.open(args.candidate).convert("RGB").crop(parse_box(args.cand_box))
    ref_mask = normalize_mask(warm_mask(reference), args.size, args.padding)
    cand_mask = normalize_mask(warm_mask(candidate), args.size, args.padding)
    ref_area, _ref_bbox, ref_centroid, ref_aspect = mask_stats(ref_mask)
    cand_area, _cand_bbox, cand_centroid, cand_aspect = mask_stats(cand_mask)
    metrics = {
        "iou": round(mask_iou(ref_mask, cand_mask), 4),
        "ref_area": ref_area,
        "cand_area": cand_area,
        "area_ratio": round(cand_area / ref_area, 4) if ref_area else 0,
        "ref_aspect": round(ref_aspect, 4),
        "cand_aspect": round(cand_aspect, 4),
        "centroid_delta": [round(cand_centroid[0] - ref_centroid[0], 2), round(cand_centroid[1] - ref_centroid[1], 2)],
    }

    panel = Image.new("RGB", (980, 420), "white")
    draw = ImageDraw.Draw(panel)
    draw.text((14, 12), args.label, fill=(20, 20, 20))
    draw.text((14, 34), json.dumps(metrics, ensure_ascii=False), fill=(20, 20, 20))
    thumbs = [
        ("reference crop", reference),
        ("candidate crop", candidate),
        ("ref warm mask", ref_mask.convert("RGB")),
        ("cand warm mask", cand_mask.convert("RGB")),
        ("warm overlay", overlay_masks(ref_mask, cand_mask)),
    ]
    x = 14
    for title, image in thumbs:
        thumb = ImageOps.contain(image, (180, 300), Image.Resampling.LANCZOS)
        panel.paste(thumb, (x, 92))
        draw.text((x, 76), title, fill=(20, 20, 20))
        x += 192
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    panel.save(args.out)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(metrics, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
