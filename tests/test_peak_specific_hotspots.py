import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import peak_specific_hotspots as psh  # noqa: E402


class ClassifyTests(unittest.TestCase):
    def test_peak_specific_needs_clear_gap_and_free_night(self):
        self.assertEqual(psh.classify(0.4, 0.0, 0.0, 45.0), "peak_specific")

    def test_always_slow_when_holiday_matches_peak(self):
        self.assertEqual(psh.classify(0.6, 0.5, 0.0, 30.0), "always_slow")
        self.assertEqual(psh.classify(0.4, 0.05, 0.3, 30.0), "always_slow")

    def test_speed_floor_when_empty_night_is_below_threshold(self):
        self.assertEqual(psh.classify(0.6, 0.1, 0.0, 15.0), "speed_floor")

    def test_not_hot_and_missing_baseline(self):
        self.assertEqual(psh.classify(0.05, 0.0, 0.0, 40.0), "not_hot")
        self.assertEqual(psh.classify(0.5, None, None, 40.0), "baseline_missing")

    def test_unclear_small_gap(self):
        self.assertEqual(psh.classify(0.2, 0.1, 0.0, 40.0), "unclear")


class BuildTests(unittest.TestCase):
    def test_build_from_synthetic_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            hist = os.path.join(tmp, "history")
            weeks = os.path.join(tmp, "weeks")
            os.makedirs(hist)
            os.makedirs(weeks)
            sensors = [{"id": "A:1", "vd_id": "A", "link_id": "1", "name": "測試路", "direction": "E", "lat": 25.0, "lon": 121.0, "lanes": 2}]
            cols = ["sensor", "speed", "occupancy", "volume", "active_lanes", "status"]

            def day_file(day, peak_hot):
                frames = []
                for h in range(24):
                    for m in (0, 15, 30, 45):
                        ts = f"{day}T{h:02d}:{m:02d}:00+08:00"
                        in_peak = 7 * 60 <= h * 60 + m <= 9 * 60 + 30
                        speed, occ = (10.0, 40.0) if (in_peak and peak_hot) else (45.0, 5.0)
                        frames.append([ts, [[0, speed, occ, 10.0, 2, "0"]]])
                with open(os.path.join(hist, f"{day}.json"), "w", encoding="utf-8") as fh:
                    json.dump({"day": day, "columns": cols, "sensors": sensors, "frames": frames}, fh)

            days = []
            for i, day in enumerate(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-10", "2026-10-11"]):
                weekday = i + 1 if i < 4 else i + 2
                days.append({"day": day, "weekday": weekday, "reference_holiday": weekday >= 6})
                day_file(day, peak_hot=weekday < 6)
            with open(os.path.join(weeks, "2026-10-05.json"), "w", encoding="utf-8") as fh:
                json.dump({"days": days}, fh)

            result = psh.build(hist, weeks)
            am = [r for r in result["rows"] if r["period"] == "am"]
            self.assertEqual(len(am), 1)
            self.assertEqual(am[0]["classification"], "peak_specific")
            self.assertEqual(am[0]["weekday_days"], 4)
            self.assertEqual(am[0]["holiday_hot_share"], 0.0)
            self.assertEqual(result["days_used"]["holiday"], ["2026-10-10", "2026-10-11"])


if __name__ == "__main__":
    unittest.main()
