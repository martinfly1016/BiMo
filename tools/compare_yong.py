#!/usr/bin/env python3
"""Compare a rendered BiMo Yong image against a reference frame.

The script is intentionally small and local: it converts red/brown ink to masks,
normalizes each mask into a common canvas, then reports shape and edge metrics.
It is not a judgment of calligraphy quality, but it makes direction changes
visible enough to guide brush-model iterations.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps


@dataclass
class MaskStats:
    area: int
    bbox: tuple[int, int, int, int]
    centroid: tuple[float, float]
    aspect: float


def parse_box(value: str | None) -> tuple[int, int, int, int] | None:
    if not value:
        return None
    parts = [int(part) for part in value.split(",")]
    if len(parts) != 4:
        raise ValueError(f"box must be left,top,right,bottom: {value}")
    return tuple(parts)  # type: ignore[return-value]


def expand_box(
    box: tuple[int, int, int, int],
    image_size: tuple[int, int],
    margin_ratio: float = 0.18,
) -> tuple[int, int, int, int]:
    left, top, right, bottom = box
    width = right - left
    height = bottom - top
    margin = int(max(width, height) * margin_ratio)
    image_width, image_height = image_size
    return (
        max(0, left - margin),
        max(0, top - margin),
        min(image_width, right + margin),
        min(image_height, bottom + margin),
    )


def ink_mask(image: Image.Image) -> Image.Image:
    rgb = image.convert("RGB")
    out = Image.new("L", rgb.size, 0)
    src = rgb.load()
    dst = out.load()
    width, height = rgb.size
    for y in range(height):
        for x in range(width):
            r, g, b = src[x, y]
            warm_ink = r > 72 and r > g * 1.08 and r > b * 1.16 and (r - min(g, b)) > 22
            dark_ink = r < 86 and g < 78 and b < 66 and (r + g + b) < 220
            if warm_ink or dark_ink:
                dst[x, y] = 255
    out = out.filter(ImageFilter.MedianFilter(3))
    return remove_rule_lines(out)


def auto_ink_box(
    image: Image.Image,
    search_box: tuple[int, int, int, int] | None,
    margin_ratio: float,
) -> tuple[int, int, int, int] | None:
    if search_box:
        search = image.crop(search_box)
        mask = ink_mask(search)
        bbox = mask.getbbox()
        if not bbox:
            return None
        left, top, right, bottom = bbox
        absolute = (left + search_box[0], top + search_box[1], right + search_box[0], bottom + search_box[1])
    else:
        mask = ink_mask(image)
        absolute = mask.getbbox()
        if not absolute:
            return None
    return expand_box(absolute, image.size, margin_ratio)


def remove_rule_lines(mask: Image.Image) -> Image.Image:
    """Drop red guide/grid lines that are thin, long connected components."""
    src = mask.load()
    width, height = mask.size
    visited = bytearray(width * height)
    out = Image.new("L", mask.size, 0)
    dst = out.load()
    for start_y in range(height):
        for start_x in range(width):
            idx = start_y * width + start_x
            if visited[idx] or src[start_x, start_y] == 0:
                continue
            stack = [(start_x, start_y)]
            visited[idx] = 1
            points: list[tuple[int, int]] = []
            min_x = max_x = start_x
            min_y = max_y = start_y
            while stack:
                x, y = stack.pop()
                points.append((x, y))
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                min_y = min(min_y, y)
                max_y = max(max_y, y)
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if nx < 0 or ny < 0 or nx >= width or ny >= height:
                        continue
                    nidx = ny * width + nx
                    if visited[nidx] or src[nx, ny] == 0:
                        continue
                    visited[nidx] = 1
                    stack.append((nx, ny))
            comp_w = max_x - min_x + 1
            comp_h = max_y - min_y + 1
            area = len(points)
            long_horizontal = comp_w > width * 0.42 and comp_h <= max(9, height * 0.04)
            long_vertical = comp_h > height * 0.42 and comp_w <= max(9, width * 0.04)
            tiny_noise = area < 16
            if long_horizontal or long_vertical or tiny_noise:
                continue
            for x, y in points:
                dst[x, y] = 255
    return out


def stats(mask: Image.Image) -> MaskStats:
    bbox = mask.getbbox() or (0, 0, 1, 1)
    pixels = mask.load()
    width, height = mask.size
    area = 0
    sx = 0
    sy = 0
    for y in range(height):
        for x in range(width):
            if pixels[x, y] > 0:
                area += 1
                sx += x
                sy += y
    centroid = (sx / area, sy / area) if area else (0.0, 0.0)
    bw = max(1, bbox[2] - bbox[0])
    bh = max(1, bbox[3] - bbox[1])
    return MaskStats(area=area, bbox=bbox, centroid=centroid, aspect=bw / bh)


def normalize_mask(mask: Image.Image, size: int, padding: int) -> Image.Image:
    bbox = mask.getbbox()
    out = Image.new("L", (size, size), 0)
    if not bbox:
        return out
    cropped = mask.crop(bbox)
    max_side = max(cropped.size)
    scale = max(1, size - padding * 2)
    cropped.thumbnail((scale, scale), Image.Resampling.LANCZOS)
    out.paste(cropped, ((size - cropped.width) // 2, (size - cropped.height) // 2))
    return out.point(lambda value: 255 if value > 60 else 0)


def edge_mask(mask: Image.Image) -> Image.Image:
    return mask.filter(ImageFilter.FIND_EDGES).point(lambda value: 255 if value > 24 else 0)


def mask_iou(a: Image.Image, b: Image.Image) -> float:
    a_data = list(a.getdata())
    b_data = list(b.getdata())
    inter_area = 0
    union_area = 0
    for av, bv in zip(a_data, b_data):
        aa = av > 0
        bb = bv > 0
        if aa and bb:
            inter_area += 1
        if aa or bb:
            union_area += 1
    return inter_area / union_area if union_area else 0.0


def edge_delta(a: Image.Image, b: Image.Image) -> float:
    ea = edge_mask(a)
    eb = edge_mask(b)
    diff = ImageChops.difference(ea, eb)
    return sum(diff.getdata()) / (255 * diff.width * diff.height)


def render_panel(
    reference: Image.Image,
    candidate: Image.Image,
    ref_mask: Image.Image,
    cand_mask: Image.Image,
    normalized_ref: Image.Image,
    normalized_cand: Image.Image,
    label: str,
    metrics: dict[str, float | int | list[float]],
) -> Image.Image:
    panel = Image.new("RGB", (980, 420), "white")
    draw = ImageDraw.Draw(panel)
    draw.text((14, 12), label, fill=(25, 25, 25))
    draw.text((14, 34), json.dumps(metrics, ensure_ascii=False), fill=(35, 35, 35))

    thumbs: Iterable[tuple[str, Image.Image]] = [
        ("reference", reference.convert("RGB")),
        ("candidate", candidate.convert("RGB")),
        ("ref mask", ref_mask.convert("RGB")),
        ("candidate mask", cand_mask.convert("RGB")),
        ("normalized overlay", overlay_masks(normalized_ref, normalized_cand)),
    ]
    x = 14
    for title, image in thumbs:
        thumb = ImageOps.contain(image, (180, 300), Image.Resampling.LANCZOS)
        panel.paste(thumb, (x, 92))
        draw.text((x, 76), title, fill=(25, 25, 25))
        x += 192
    return panel


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
                dst[x, y] = (70, 100, 220)
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", required=True)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--ref-box")
    parser.add_argument("--cand-box")
    parser.add_argument("--cand-search-box")
    parser.add_argument("--auto-cand-box", action="store_true")
    parser.add_argument("--auto-margin", type=float, default=0.18)
    parser.add_argument("--label", default="yong")
    parser.add_argument("--out", required=True)
    parser.add_argument("--json-out")
    parser.add_argument("--size", type=int, default=360)
    parser.add_argument("--padding", type=int, default=18)
    args = parser.parse_args()

    reference = Image.open(args.reference)
    candidate = Image.open(args.candidate)
    ref_box = parse_box(args.ref_box)
    cand_box = parse_box(args.cand_box)
    cand_search_box = parse_box(args.cand_search_box)
    if args.auto_cand_box:
        cand_box = auto_ink_box(candidate, cand_search_box, args.auto_margin)
    if ref_box:
        reference = reference.crop(ref_box)
    if cand_box:
        candidate = candidate.crop(cand_box)

    ref_mask = ink_mask(reference)
    cand_mask = ink_mask(candidate)
    ref_norm = normalize_mask(ref_mask, args.size, args.padding)
    cand_norm = normalize_mask(cand_mask, args.size, args.padding)
    ref_stats = stats(ref_norm)
    cand_stats = stats(cand_norm)
    metrics = {
        "iou": round(mask_iou(ref_norm, cand_norm), 4),
        "edge_delta": round(edge_delta(ref_norm, cand_norm), 4),
        "ref_area": ref_stats.area,
        "cand_area": cand_stats.area,
        "area_ratio": round(cand_stats.area / ref_stats.area, 4) if ref_stats.area else 0,
        "ref_aspect": round(ref_stats.aspect, 4),
        "cand_aspect": round(cand_stats.aspect, 4),
        "centroid_delta": [
            round(cand_stats.centroid[0] - ref_stats.centroid[0], 2),
            round(cand_stats.centroid[1] - ref_stats.centroid[1], 2),
        ],
    }
    panel = render_panel(reference, candidate, ref_mask, cand_mask, ref_norm, cand_norm, args.label, metrics)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    panel.save(args.out, quality=92)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(metrics, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
