"""Extract an ordered racing centerline from a circuit map image.

The start marker and direction are deliberately explicit: image parsing finds the
centerline, while these two values prevent the common reversed-lap ambiguity.
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

INPUT = Path("assets/tracks/ZeltwegAirfield.png")
OUTPUT = Path("assets/tracks/ZeltwegAirfield-waypoints.json")
START = np.array([124, 266], dtype=np.float32)  # Checkered flag / red-arrow start.
DIRECTION = np.array([-1.0, 0.25], dtype=np.float32)  # Direction indicated by the red arrow.


def skeletonize(mask: np.ndarray) -> np.ndarray:
    """Connectivity-preserving Zhang-Suen thinning for a single closed stroke."""
    image = (mask > 0).astype(np.uint8)
    changed = True
    while changed:
        changed = False
        for phase in (0, 1):
            remove: list[tuple[int, int]] = []
            for y in range(1, image.shape[0] - 1):
                for x in range(1, image.shape[1] - 1):
                    if not image[y, x]:
                        continue
                    p2, p3, p4, p5, p6, p7, p8, p9 = [
                        image[y - 1, x], image[y - 1, x + 1], image[y, x + 1], image[y + 1, x + 1],
                        image[y + 1, x], image[y + 1, x - 1], image[y, x - 1], image[y - 1, x - 1],
                    ]
                    neighbors = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
                    transitions = sum(a == 0 and b == 1 for a, b in zip((p2, p3, p4, p5, p6, p7, p8, p9), (p3, p4, p5, p6, p7, p8, p9, p2)))
                    if not (2 <= neighbors <= 6 and transitions == 1):
                        continue
                    if phase == 0 and (p2 * p4 * p6 or p4 * p6 * p8):
                        continue
                    if phase == 1 and (p2 * p4 * p8 or p2 * p6 * p8):
                        continue
                    remove.append((y, x))
            if remove:
                changed = True
                for y, x in remove:
                    image[y, x] = 0
    return (image * 255).astype(np.uint8)


def ordered_cycle(skeleton: np.ndarray) -> list[tuple[int, int]]:
    points = np.argwhere(skeleton > 0)
    point_set = {tuple(point) for point in points}
    start_yx = min(point_set, key=lambda p: float(np.sum((np.array([p[1], p[0]]) - START) ** 2)))
    neighbors = [(start_yx[0] + dy, start_yx[1] + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1)
                 if (dx or dy) and (start_yx[0] + dy, start_yx[1] + dx) in point_set]
    if len(neighbors) < 2:
        raise RuntimeError("Could not find both centerline directions at the start marker.")
    direction = DIRECTION / np.linalg.norm(DIRECTION)
    current = max(neighbors, key=lambda p: float(np.dot(np.array([p[1] - start_yx[1], p[0] - start_yx[0]]), direction)))
    ordered = [start_yx, current]
    previous = start_yx
    visited = {start_yx, current}
    while len(ordered) <= len(point_set):
        candidates = [(current[0] + dy, current[1] + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1)
                      if (dx or dy) and (current[0] + dy, current[1] + dx) in point_set and (current[0] + dy, current[1] + dx) != previous and (current[0] + dy, current[1] + dx) not in visited]
        if not candidates:
            break
        if start_yx in candidates and len(ordered) > 24:
            break
        travel = np.array([current[1] - previous[1], current[0] - previous[0]], dtype=np.float32)
        previous, current = current, max(candidates, key=lambda p: float(np.dot(np.array([p[1] - current[1], p[0] - current[0]]), travel)))
        ordered.append(current)
        visited.add(current)
    return [(int(x), int(y)) for y, x in ordered]


def main() -> None:
    image = cv2.imread(str(INPUT), cv2.IMREAD_UNCHANGED)
    if image is None or image.shape[2] != 4:
        raise RuntimeError(f"Expected an RGBA PNG at {INPUT}")
    bgr, alpha = image[:, :, :3], image[:, :, 3]
    grayscale = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    black = np.where((alpha > 10) & (grayscale < 80), 255, 0).astype(np.uint8)
    _, labels, stats, _ = cv2.connectedComponentsWithStats(black, connectivity=8)
    track_label = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    track = np.where(labels == track_label, 255, 0).astype(np.uint8)
    # The anti-aliased PNG has one-pixel gaps at a few joins; close those before thinning.
    connected_track = cv2.dilate(track, np.ones((3, 3), np.uint8))
    points = ordered_cycle(skeletonize(connected_track))
    # Keep enough points for corners but avoid shipping every single pixel.
    sampled = points[::3]
    if sampled[-1] != points[-1]:
        sampled.append(points[-1])
    OUTPUT.write_text(json.dumps({"width": image.shape[1], "height": image.shape[0], "points": sampled}, separators=(",", ":")))
    print(f"Wrote {len(sampled)} ordered waypoints to {OUTPUT}")


if __name__ == "__main__":
    main()
