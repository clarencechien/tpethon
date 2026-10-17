"""Rank direction-level VD hotspots by how much they are specific to weekday peaks.

Answers one bounded question from data already in ``data/history``:

    In the committed 15-minute VD snapshots, which direction-level sensors are
    slow and dense *only* during weekday peaks, compared with the same sensor's
    own holiday and night baseline?

A sensor that is also slow at 03:00 or on a holiday is not evidence of a
commuting bottleneck; it is more likely a stop-line position, a short local
street or a device characteristic. The output is a screening list for field
checks. It does not estimate queue length, delay, cause or capacity.

Usage:
    python scripts/peak_specific_hotspots.py            # markdown table to stdout
    python scripts/peak_specific_hotspots.py --json out.json
"""
from __future__ import annotations

import argparse
import glob
import json
import os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HISTORY_DIR = os.path.join(ROOT, "data", "history")
WEEKS_DIR = os.path.join(ROOT, "data", "weeks")

SLOW_KPH = 20.0
HOT_OCCUPANCY = 25.0
AM = (7 * 60, 9 * 60 + 30)
PM = (17 * 60, 19 * 60 + 30)
NIGHT = (0, 6 * 60)  # 00:00–06:00, weekday nights only
MIN_PEAK_VALID = 40
MIN_BASE_VALID = 12


def load_calendar() -> dict[str, dict]:
    days: dict[str, dict] = {}
    for path in sorted(glob.glob(os.path.join(WEEKS_DIR, "*.json"))):
        if os.path.basename(path) in {"index.json", "profiles.json"}:
            continue
        with open(path, encoding="utf-8") as handle:
            week = json.load(handle)
        for day in week.get("days", []):
            days[day["day"]] = day
    return days


def day_type(day: str, calendar: dict[str, dict]) -> str | None:
    meta = calendar.get(day)
    if meta is None:
        return None
    if meta["weekday"] >= 6 or meta.get("reference_holiday"):
        return "holiday"
    return "weekday"


def minute_of(ts: str) -> int:
    return int(ts[11:13]) * 60 + int(ts[14:16])


def in_window(minute: int, window: tuple[int, int]) -> bool:
    return window[0] <= minute <= window[1]


def bucket(minute: int, dtype: str) -> str | None:
    if in_window(minute, AM):
        return f"{dtype}_am"
    if in_window(minute, PM):
        return f"{dtype}_pm"
    if dtype == "weekday" and NIGHT[0] <= minute < NIGHT[1]:
        return "weekday_night"
    return None


def collect(history_dir: str, calendar: dict[str, dict]):
    stats = defaultdict(lambda: defaultdict(lambda: {"valid": 0, "hot": 0, "speed": 0.0, "volume": 0.0, "days": set()}))
    names: dict[str, dict] = {}
    used_days: dict[str, list[str]] = {"weekday": [], "holiday": []}
    for path in sorted(glob.glob(os.path.join(history_dir, "20*.json"))):
        with open(path, encoding="utf-8") as handle:
            day = json.load(handle)
        dtype = day_type(day["day"], calendar)
        if dtype is None:
            continue
        used_days[dtype].append(day["day"])
        columns = {name: i for i, name in enumerate(day["columns"])}
        sensors = day["sensors"]
        for ts, rows in day["frames"]:
            key = bucket(minute_of(ts), dtype)
            if key is None:
                continue
            for row in rows:
                sensor = sensors[row[columns["sensor"]]]
                speed = row[columns["speed"]]
                occupancy = row[columns["occupancy"]]
                active = row[columns["active_lanes"]]
                status = row[columns["status"]]
                if speed is None or not active or status != "0":
                    continue
                names.setdefault(sensor["id"], {k: sensor[k] for k in ("vd_id", "link_id", "name", "direction", "lat", "lon")})
                cell = stats[sensor["id"]][key]
                cell["valid"] += 1
                cell["speed"] += speed
                cell["volume"] += row[columns["volume"]] or 0.0
                cell["days"].add(day["day"])
                if speed < SLOW_KPH and occupancy is not None and occupancy >= HOT_OCCUPANCY:
                    cell["hot"] += 1
    return stats, names, used_days


def share(cell: dict) -> float | None:
    return cell["hot"] / cell["valid"] if cell["valid"] else None


def classify(peak: float, holiday: float | None, night: float | None, night_speed: float | None = None) -> str:
    """Label one sensor-period from its weekday-peak hot share and its own baselines.

    ``night_speed`` is the weekday 00:00–06:00 mean speed. When even the empty
    night road reads below the slow threshold, the speed part of the hotspot
    rule cannot separate peak from off-peak at this sensor, so the only signal
    left is occupancy; such a sensor is labelled ``speed_floor``.
    """
    baseline = max(x for x in (holiday, night) if x is not None) if (holiday is not None or night is not None) else None
    if baseline is None:
        return "baseline_missing"
    if peak < 0.15:
        return "not_hot"
    if baseline >= 0.2 or baseline >= 0.6 * peak:
        return "always_slow"
    if night_speed is not None and night_speed < SLOW_KPH:
        return "speed_floor"
    if peak - baseline >= 0.15:
        return "peak_specific"
    return "unclear"


LABELS = {
    "peak_specific": "尖峰特有",
    "always_slow": "全天／假日也慢（疑測站位置或號誌停等）",
    "speed_floor": "深夜空路也低於20 km/h（速度門檻無鑑別力）",
    "unclear": "差異不明顯",
    "not_hot": "尖峰不熱",
    "baseline_missing": "缺對照",
}


def build(history_dir: str = HISTORY_DIR, weeks_dir: str = WEEKS_DIR) -> dict:
    global WEEKS_DIR
    WEEKS_DIR = weeks_dir
    calendar = load_calendar()
    stats, names, used_days = collect(history_dir, calendar)
    rows = []
    for sensor_id, cells in stats.items():
        for period in ("am", "pm"):
            peak = cells[f"weekday_{period}"]
            if peak["valid"] < MIN_PEAK_VALID:
                continue
            hol = cells[f"holiday_{period}"]
            night = cells["weekday_night"]
            hol_share = share(hol) if hol["valid"] >= MIN_BASE_VALID else None
            night_share = share(night) if night["valid"] >= MIN_BASE_VALID else None
            peak_share = share(peak)
            night_speed = night["speed"] / night["valid"] if night["valid"] >= MIN_BASE_VALID else None
            rows.append({
                **names[sensor_id],
                "sensor_id": sensor_id,
                "period": period,
                "weekday_days": len(peak["days"]),
                "peak_valid": peak["valid"],
                "peak_hot": peak["hot"],
                "peak_hot_share": round(peak_share, 3),
                "peak_mean_speed": round(peak["speed"] / peak["valid"], 1),
                "peak_mean_volume": round(peak["volume"] / peak["valid"], 1),
                "holiday_valid": hol["valid"],
                "holiday_hot_share": None if hol_share is None else round(hol_share, 3),
                "night_valid": night["valid"],
                "night_hot_share": None if night_share is None else round(night_share, 3),
                "night_mean_speed": None if night_speed is None else round(night_speed, 1),
                "classification": classify(peak_share, hol_share, night_share, night_speed),
            })
    rows.sort(key=lambda r: (r["period"], -(r["peak_hot_share"] - max(x for x in (r["holiday_hot_share"], r["night_hot_share"], 0.0) if x is not None))))
    return {
        "schema_version": 1,
        "question": "Which direction-level VD sensors are slow (<20 km/h) and dense (occupancy >=25%) only in weekday peaks, relative to the same sensor's holiday and weekday-night baseline?",
        "thresholds": {"slow_kph": SLOW_KPH, "hot_occupancy": HOT_OCCUPANCY, "am": "07:00-09:30", "pm": "17:00-19:30", "night": "00:00-06:00 weekdays", "min_peak_valid": MIN_PEAK_VALID, "min_baseline_valid": MIN_BASE_VALID},
        "days_used": used_days,
        "limitations": [
            "15-minute instantaneous snapshots; not travel time, queue length or delay",
            "weekday/holiday split uses the community calendar mirror in data/weeks, not an official calendar",
            "a peak-specific sensor is a field-check candidate, not a proven bottleneck or its cause",
            "only three holiday days; a single rainy or incident day can move a holiday baseline",
        ],
        "counts": {label: sum(1 for r in rows if r["classification"] == label) for label in LABELS},
        "rows": rows,
    }


def markdown(result: dict, limit: int = 20) -> str:
    out = []
    for period, title in (("am", "晨峰 07:00–09:30"), ("pm", "晚峰 17:00–19:30")):
        out.append(f"\n### {title}\n")
        out.append("| 路段 | 方向 | 工作日熱點占比 | 假日同時段 | 工作日深夜 | 尖峰均速 | 深夜均速 | 尖峰每筆車流 | 判定 |")
        out.append("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |")
        shown = 0
        for r in result["rows"]:
            if r["period"] != period or r["classification"] in {"not_hot", "baseline_missing"}:
                continue
            fmt = lambda v: "—" if v is None else f"{v:.0%}"
            out.append(f"| {r['name']} | {r['direction']} | {fmt(r['peak_hot_share'])} ({r['peak_hot']}/{r['peak_valid']}) | {fmt(r['holiday_hot_share'])} | {fmt(r['night_hot_share'])} | {r['peak_mean_speed']} | {'—' if r['night_mean_speed'] is None else r['night_mean_speed']} | {r['peak_mean_volume']} | {LABELS[r['classification']]} |")
            shown += 1
            if shown >= limit:
                break
    return "\n".join(out)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--json", help="write full result JSON to this path")
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()
    result = build()
    if args.json:
        with open(args.json, "w", encoding="utf-8") as handle:
            json.dump(result, handle, ensure_ascii=False, indent=1)
    print("days used:", result["days_used"])
    print("counts:", result["counts"])
    print(markdown(result, args.limit))


if __name__ == "__main__":
    main()
