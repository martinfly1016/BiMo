#!/usr/bin/env python3
"""Compare Yong renderings by stroke-sized regions.

The global warm-ink IoU is useful as a guardrail, but it hides which stroke is
responsible for a regression. This script uses the same warm ink extraction as
compare_yong_warm.py, then reports metrics inside coarse regions that map to
the visible stroke groups in the reference video.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps


REGIONS = {
    "top_dot": (82, 20, 150, 78),
    "heng_shu_gou": (72, 54, 158, 224),
    "left_pie": (22, 88, 118, 218),
    "right_side_dot": (132, 70, 198, 146),
    "right_nai": (124, 118, 246, 230),
}


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


def mask_stats(mask: Image.Image) -> dict[str, object]:
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
    centroid = [sx / area, sy / area] if area else [0.0, 0.0]
    aspect = (bbox[2] - bbox[0]) / max(1, bbox[3] - bbox[1])
    return {"area": area, "bbox": bbox, "centroid": centroid, "aspect": aspect}


def compare_masks(ref_mask: Image.Image, cand_mask: Image.Image) -> dict[str, object]:
    ref = ref_mask.load()
    cand = cand_mask.load()
    inter = 0
    union = 0
    ref_only = 0
    cand_only = 0
    for y in range(ref_mask.height):
        for x in range(ref_mask.width):
            r = ref[x, y] > 0
            c = cand[x, y] > 0
            if r and c:
                inter += 1
            elif r:
                ref_only += 1
            elif c:
                cand_only += 1
            if r or c:
                union += 1
    ref_stats = mask_stats(ref_mask)
    cand_stats = mask_stats(cand_mask)
    ref_area = int(ref_stats["area"])
    cand_area = int(cand_stats["area"])
    ref_centroid = ref_stats["centroid"]
    cand_centroid = cand_stats["centroid"]
    return {
        "iou": round(inter / union, 4) if union else 0.0,
        "ref_area": ref_area,
        "cand_area": cand_area,
        "area_ratio": round(cand_area / ref_area, 4) if ref_area else 0,
        "ref_only": ref_only,
        "cand_only": cand_only,
        "centroid_delta": [
            round(float(cand_centroid[0]) - float(ref_centroid[0]), 2),
            round(float(cand_centroid[1]) - float(ref_centroid[1]), 2),
        ],
    }


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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", required=True)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--ref-box", required=True)
    parser.add_argument("--cand-box", required=True)
    parser.add_argument("--label", default="region-compare")
    parser.add_argument("--size", type=int, default=260)
    parser.add_argument("--padding", type=int, default=24)
    parser.add_argument("--out", required=True)
    parser.add_argument("--json-out")
    args = parser.parse_args()

    reference = Image.open(args.reference).convert("RGB").crop(parse_box(args.ref_box))
    candidate = Image.open(args.candidate).convert("RGB").crop(parse_box(args.cand_box))
    ref_mask = normalize_mask(warm_mask(reference), args.size, args.padding)
    cand_mask = normalize_mask(warm_mask(candidate), args.size, args.padding)

    metrics = {"global": compare_masks(ref_mask, cand_mask), "regions": {}}
    for name, box in REGIONS.items():
        metrics["regions"][name] = compare_masks(ref_mask.crop(box), cand_mask.crop(box))

    overlay = overlay_masks(ref_mask, cand_mask)
    draw = ImageDraw.Draw(overlay)
    for name, box in REGIONS.items():
        draw.rectangle(box, outline=(20, 20, 20), width=1)
        draw.text((box[0] + 2, box[1] + 2), name, fill=(20, 20, 20))

    panel = Image.new("RGB", (1040, 520), "white")
    panel_draw = ImageDraw.Draw(panel)
    panel_draw.text((14, 12), args.label, fill=(20, 20, 20))
    panel_draw.text((14, 34), json.dumps(metrics["global"], ensure_ascii=False), fill=(20, 20, 20))
    panel.paste(ImageOps.contain(ref_mask.convert("RGB"), (250, 360), Image.Resampling.NEAREST), (14, 108))
    panel.paste(ImageOps.contain(cand_mask.convert("RGB"), (250, 360), Image.Resampling.NEAREST), (282, 108))
    panel.paste(ImageOps.contain(overlay, (360, 360), Image.Resampling.NEAREST), (550, 108))
    panel_draw.text((14, 88), "ref warm mask", fill=(20, 20, 20))
    panel_draw.text((282, 88), "candidate warm mask", fill=(20, 20, 20))
    panel_draw.text((550, 88), "region overlay", fill=(20, 20, 20))
    y = 390
    for name, values in metrics["regions"].items():
        panel_draw.text((14, y), f"{name}: {json.dumps(values, ensure_ascii=False)}", fill=(20, 20, 20))
        y += 22

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    panel.save(args.out)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(metrics, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
