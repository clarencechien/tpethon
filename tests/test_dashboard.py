import unittest
from dashboard import parse_roads
from scripts.build_pages import merge_frames

STATIC=b'<VDList><VD><VDID>V1</VDID><RoadName>Road</RoadName><PositionLon>121.58</PositionLon><PositionLat>25.08</PositionLat><DetectionLink><LinkID>N</LinkID><RoadDirection>N</RoadDirection><Bearing>N</Bearing></DetectionLink><DetectionLink><LinkID>S</LinkID><RoadDirection>S</RoadDirection><Bearing>S</Bearing></DetectionLink></VD></VDList>'
def lane(speed,occ,volume):
    return f'<Lane><Speed>{speed}</Speed><Occupancy>{occ}</Occupancy><Vehicle><Volume>{volume}</Volume></Vehicle></Lane>'
def payload(north,south):
    return f'<VDLiveList><UpdateTime>2026-10-16T08:00:00+08:00</UpdateTime><VDLive><VDID>V1</VDID><Status>0</Status><DataCollectTime>2026-10-16T08:00:00+08:00</DataCollectTime><LinkFlow><LinkID>N</LinkID>{north}</LinkFlow><LinkFlow><LinkID>S</LinkID>{south}</LinkFlow></VDLive></VDLiveList>'.encode()
class DirectionalTests(unittest.TestCase):
    def test_directions_not_averaged_together(self):
        rows=parse_roads(payload(lane(5,50,3),lane(60,5,20)),STATIC)['rows']
        self.assertEqual([r['speed'] for r in rows],[5,60])
        self.assertEqual([r['direction'] for r in rows],['N','S'])
    def test_empty_lane_does_not_lower_speed(self):
        rows=parse_roads(payload(lane(0,0,0)+lane(60,5,10),lane(0,0,0)),STATIC)['rows']
        self.assertEqual(rows[0]['speed'],60)
        self.assertIsNone(rows[1]['speed'])
    def test_standing_queue_retains_zero_speed(self):
        row=parse_roads(payload(lane(0,80,0),lane(30,10,4)),STATIC)['rows'][0]
        self.assertEqual(row['speed'],0);self.assertEqual(row['active_lanes'],1)
    def test_repeated_snapshot_not_counted_as_history(self):
        frame={'captured_at':'2026-10-16T08:00:00+08:00','road':{'timestamp':'2026-10-16T07:59:00+08:00','rows':[]}}
        new={**frame,'captured_at':'2026-10-16T08:01:00+08:00'}
        self.assertEqual(len(merge_frames([frame],new)),1)
    def test_failed_fetch_is_preserved_as_gap(self):
        frame={'captured_at':'2026-10-16T08:00:00+08:00','road':{'timestamp':'2026-10-16T07:59:00+08:00','rows':[]}}
        new={'captured_at':'2026-10-16T08:15:00+08:00','road':{'error':'unavailable','rows':[]}}
        self.assertEqual(len(merge_frames([frame],new)),2)
if __name__=='__main__':unittest.main()
