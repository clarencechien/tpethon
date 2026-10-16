import csv
import io
import unittest
from app import parse_csv
from live import buses, roads, freshness
from metro import aggregate
import json
from unittest.mock import patch
from tempfile import TemporaryDirectory
from pathlib import Path
import metro

HEADER='mode,timestamp,location,metric,value,interval_minutes,source\n'
class ImportTests(unittest.TestCase):
    def test_valid_timezone_and_zero(self):
        rows=parse_csv(HEADER+'road,2026-10-15T00:00:00+00:00,VD-A,vehicles,0,5,official\n')
        self.assertEqual(rows[0]['timestamp'],'2026-10-15T08:00:00+08:00')
        self.assertEqual(rows[0]['value'],0)
    def test_invalid_not_saved(self):
        for metric,value,time in [('vehicles','NaN','08:00:00+08:00'),('entries','1','08:00:00+08:00'),('vehicles','-1','08:00:00+08:00'),('vehicles','1','08:01:00+08:00'),('vehicles','1','08:00:00')]:
            with self.subTest(metric=metric,value=value,time=time),self.assertRaises(ValueError):
                parse_csv(HEADER+f'road,2026-10-15T{time},VD-A,{metric},{value},5,official\n')
    def test_duplicates_and_overlapping_windows(self):
        row='road,2026-10-15T08:00:00+08:00,VD-A,vehicles,4,15,official\n'
        with self.assertRaises(ValueError):parse_csv(HEADER+row+row)
        with self.assertRaises(ValueError):parse_csv(HEADER+row+'road,2026-10-15T08:05:00+08:00,VD-A,vehicles,3,5,official\n')

class FeedTests(unittest.TestCase):
    def test_bad_detector_not_zero(self):
        metadata=b'<VDList><VD><VDID>A</VDID><PositionLon>121.58</PositionLon><PositionLat>25.08</PositionLat><RoadName>Road</RoadName></VD></VDList>'
        live=b'<VDLiveList><UpdateTime>2026-10-15T08:00:00+08:00</UpdateTime><UpdateInterval>60</UpdateInterval><VDLive><VDID>A</VDID><Status>1</Status><DataCollectTime>2026-10-15T08:00:00+08:00</DataCollectTime><Lane><Speed>0</Speed><Vehicle><Volume>0</Volume></Vehicle></Lane></VDLive></VDLiveList>'
        r=roads(live,metadata)['rows'][0]
        self.assertIsNone(r['volume']);self.assertIsNone(r['speed'])
    def test_bus_unavailable_not_arriving(self):
        def b(v):return json.dumps(v).encode()
        feed=b({'EssentialInfo':{'UpdateTime':'2026/10/15 08:00:00'},'BusInfo':[{'StopID':1,'RouteID':2,'EstimateTime':'-1'}]})
        stop=b({'BusInfo':[{'Id':1,'longitude':'121.58','latitude':'25.08','nameZh':'Test'}]})
        route=b({'BusInfo':[{'Id':2,'nameZh':'Route'}]})
        self.assertIsNone(buses(feed,stop,route)['rows'][0]['eta_seconds'])
    def test_old_data_stale(self):
        self.assertTrue(freshness('2024-11-14T16:26:02+08:00')['stale'])

class MetroTests(unittest.TestCase):
    def test_hourly_od_and_weekdays(self):
        reader=csv.DictReader(io.StringIO('日期,時段,進站,出站,人次\n2026-09-01,7,西湖,港墘,12\n2026-09-01,7,西湖,台北車站,8\n2026-09-05,7,西湖,港墘,99\n'))
        rows,count=aggregate(reader)
        self.assertEqual(count,3)
        self.assertEqual(sum(r['value'] for r in rows if r['metric']=='entries'),20)
        self.assertEqual(sum(r['value'] for r in rows if r['metric']=='destinations'),12)
    def test_failed_refresh_keeps_previous_actual_data(self):
        with TemporaryDirectory() as directory:
            path=Path(directory)
            old={'rows':[{'value':12}],'month':'2026-09'}
            (path/'metro.json').write_text(json.dumps(old))
            with patch.object(metro,'DATA',path),patch('metro.urllib.request.urlopen',side_effect=OSError('unavailable')):
                result=metro.refresh()
            self.assertIn('error',result)
            self.assertEqual(json.loads((path/'metro.json').read_text()),old)
    def test_unknown_schema_rejected(self):
        with self.assertRaises(ValueError):aggregate(csv.DictReader(io.StringIO('a,b\n1,2\n')))

if __name__=='__main__':unittest.main()
