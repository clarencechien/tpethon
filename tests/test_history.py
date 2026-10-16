import copy
import json
import tempfile
import unittest
from pathlib import Path
from scripts.backfill_tdx import compact_day, publish

STATIC=[dict(VDID='TEST',RoadName='測試路',PositionLat=25.075,PositionLon=121.57,
    DetectionLinks=[dict(LinkID='N',RoadDirection='N',Bearing='N'),dict(LinkID='S',RoadDirection='S',Bearing='S')])]
def observation(stamp, speed=10):
    return dict(VDID='TEST',Status=0,DataCollectTime=stamp,LinkFlows=[
        dict(LinkID='N',Lanes=[dict(Speed=speed,Occupancy=50,Vehicles=[dict(Volume=3)]),dict(Speed=0,Occupancy=0,Vehicles=[dict(Volume=0)])]),
        dict(LinkID='S',Lanes=[dict(Speed=60,Occupancy=5,Vehicles=[dict(Volume=10)])])])

class HistoryTests(unittest.TestCase):
    def test_utc_cross_midnight_and_quarter_hour_sampling(self):
        records=[observation('2026-10-14T23:00:00+00:00'),observation('2026-10-15T07:01:00+08:00'),observation('2026-10-14T23:45:00+08:00')]
        result=compact_day('2026-10-15',STATIC,records)
        self.assertEqual(result['frames'][0][0],'2026-10-15T07:00:00+08:00')
        self.assertEqual(len(result['frames']),1)
        self.assertEqual(result['frames'][0][1][0][1],10)
        self.assertEqual(result['frames'][0][1][1][1],60)
        self.assertEqual(result['counts']['outside_day'],1)
        self.assertEqual(result['counts']['off_sample'],1)
    def test_invalid_lane_speed_and_empty_lane_are_not_congestion(self):
        row=observation('2026-10-15T07:00:00+08:00',-99)
        result=compact_day('2026-10-15',STATIC,[row])
        self.assertIsNone(result['frames'][0][1][0][1])
    def test_unknown_station_is_excluded_and_duplicate_does_not_double_flow(self):
        row=observation('2026-10-15T07:00:00+08:00');unknown={**row,'VDID':'UNKNOWN'}
        result=compact_day('2026-10-15',STATIC,[row,row,unknown])
        self.assertEqual(result['counts']['duplicates'],1)
        self.assertEqual(len(result['frames'][0][1]),2)
        self.assertEqual(result['frames'][0][1][0][3],3)
    def test_conflicting_duplicates_fail_closed(self):
        a=observation('2026-10-15T07:00:00+08:00');b=observation(a['DataCollectTime'],20)
        with self.assertRaises(ValueError):compact_day('2026-10-15',STATIC,[a,b])
    def test_day_files_immutable_and_manifest_matches_actual_bytes(self):
        result=compact_day('2026-10-15',STATIC,[observation('2026-10-15T07:00:00+08:00')])
        with tempfile.TemporaryDirectory() as folder:
            output=Path(folder);entry=publish(result,output);publish(result,output)
            self.assertEqual(entry['bytes'],(output/entry['file']).stat().st_size)
            self.assertEqual(len(json.loads((output/'index.json').read_text())['days']),1)
            original=(output/entry['file']).read_bytes();changed=copy.deepcopy(result);changed['frames'][0][1][0][1]=99
            with self.assertRaises(ValueError):publish(changed,output)
            self.assertEqual((output/entry['file']).read_bytes(),original)

class DownloadRetryTests(unittest.TestCase):
    def test_rate_limit_retries_with_delay_but_auth_failure_does_not(self):
        from unittest.mock import patch,MagicMock
        from urllib.error import HTTPError
        from scripts.backfill_tdx import open_data
        response=MagicMock()
        limited=HTTPError('https://tdx.transportdata.tw/test',429,'rate limited',{'Retry-After':'15'},None)
        with patch('scripts.backfill_tdx.OPENER.open',side_effect=[limited,response]) as call,patch('scripts.backfill_tdx.time.sleep') as sleep:
            self.assertIs(open_data(object()),response);sleep.assert_called_once_with(15);self.assertEqual(call.call_count,2)
        unauthorized=HTTPError('https://tdx.transportdata.tw/test',401,'unauthorized',{},None)
        with patch('scripts.backfill_tdx.OPENER.open',side_effect=unauthorized) as call,patch('scripts.backfill_tdx.time.sleep') as sleep:
            with self.assertRaises(HTTPError):open_data(object())
            sleep.assert_not_called();self.assertEqual(call.call_count,1)
