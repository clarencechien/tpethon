import csv
import io
import json
import sqlite3
import unittest
from scripts.collect_transport import initialize, ingest_xml
from scripts.analyze_metro_od import analyze

class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:');initialize(self.db)
    def tearDown(self):self.db.close()
    def payload(self,time='07:00',status='0'):
        return f'''<VDLiveList><UpdateTime>2026-10-16T{time}:00+08:00</UpdateTime><VDLive><VDID>V1</VDID><DataCollectTime>2026-10-16T{time}:00+08:00</DataCollectTime><Status>{status}</Status><LinkFlow><LinkID>L1</LinkID><Lane><LaneID>0</LaneID><Speed>30</Speed><Occupancy>12</Occupancy><Vehicle><VehicleType>S</VehicleType><Volume>4</Volume></Vehicle></Lane></LinkFlow></VDLive></VDLiveList>'''.encode()
    def test_same_source_time_deduplicates_but_next_time_retained(self):
        ingest_xml(self.db,'vd',self.payload());ingest_xml(self.db,'vd',self.payload())
        ingest_xml(self.db,'vd',self.payload('07:01'))
        self.assertEqual(self.db.execute('SELECT count(*) FROM lanes').fetchone()[0],2)
    def test_invalid_status_is_not_a_zero_traffic_observation(self):
        ingest_xml(self.db,'vd',self.payload(status='1'))
        status,speed,occupancy,raw=self.db.execute('SELECT status,speed,occupancy,vehicles_json FROM lanes').fetchone()
        self.assertEqual(status,'1');self.assertIsNone(speed);self.assertIsNone(occupancy)
        self.assertEqual(json.loads(raw)[0]['Volume'],'4')
    def test_unrecognized_xml_is_not_a_successful_empty_capture(self):
        with self.assertRaises(ValueError):ingest_xml(self.db,'vd',b'<error>unavailable</error>')
    def test_metadata_keeps_link_direction(self):
        xml=b'<VDList><UpdateTime>2026-10-16T00:00:00+08:00</UpdateTime><VD><VDID>V1</VDID><RoadName>R</RoadName><PositionLon>121.58</PositionLon><PositionLat>25.08</PositionLat><DetectionLink><LinkID>L1</LinkID><RoadDirection>N</RoadDirection><Bearing>W</Bearing></DetectionLink></VD></VDList>'
        ingest_xml(self.db,'vd_static',xml)
        links=json.loads(self.db.execute('SELECT links_json FROM detectors').fetchone()[0])
        self.assertEqual(links[0]['RoadDirection'],'N');self.assertEqual(links[0]['Bearing'],'W')

class ODResearchTests(unittest.TestCase):
    def test_target_and_hour_filter_and_all_weekday_denominator(self):
        reader=csv.DictReader(io.StringIO('日期,時段,進站,出站,人次\n2026-09-01,7,南港,西湖,20\n2026-09-01,8,南港,港墘,10\n2026-09-01,10,南港,港墘,99\n2026-09-02,7,南港,西湖,0\n2026-09-05,7,南港,西湖,99\n2026-09-02,8,西湖,台北車站,55\n'))
        result=analyze(reader)
        self.assertEqual(result['weekdays'],2)
        self.assertEqual(result['total_journeys'],30)
        self.assertEqual(result['mean_per_weekday'],15)
        self.assertEqual(result['top_origins'][0]['station'],'南港')
    def test_schema_mismatch_is_explicit(self):
        with self.assertRaises(ValueError):analyze(csv.DictReader(io.StringIO('date,count\n2026-09-01,4\n')))

if __name__=='__main__':unittest.main()
