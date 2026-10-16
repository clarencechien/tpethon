"""Measurement validity, gaps, censored starts and dated geography for E1."""
from datetime import datetime, timedelta
import gzip
import unittest
import xml.etree.ElementTree as ET
from scripts.corridor_experiment import metadata, observation, parse_live, slots, summarize

START = datetime.fromisoformat('2026-10-15T07:00:00+08:00')

def sample(i, speed=10, occ=40):
    return dict(speed=speed, occupancy=occ, time=(START+timedelta(minutes=5*i)).isoformat())

def live(status='0', time=None, speed=0, occ=0, volume=0):
    return ET.fromstring(f'<VDLive><VDID>test</VDID><Status>{status}</Status><DataCollectTime>{time or START.isoformat()}</DataCollectTime><LinkFlows><LinkFlow><LinkID>a</LinkID><Lanes><Lane><Speed>{speed}</Speed><Occupancy>{occ}</Occupancy><Vehicles><Vehicle><Volume>{volume}</Volume></Vehicle></Vehicles></Lane></Lanes></LinkFlow></LinkFlows></VDLive>')

class CorridorTest(unittest.TestCase):
    def test_inactive_zero_is_missing_but_standing_queue_is_valid(self):
        vd=live();self.assertIsNone(observation(vd,vd.find('.//LinkFlow'),START)['speed'])
        vd=live(occ=50);self.assertEqual(observation(vd,vd.find('.//LinkFlow'),START)['speed'],0)

    def test_invalid_stale_negative_and_nan_excluded(self):
        for vd in [live(status='2',volume=2),live(time=(START-timedelta(minutes=5)).isoformat(),volume=2),live(speed=-1,volume=3),live(speed='NaN',volume=3)]:
            self.assertIsNone(observation(vd,vd.find('.//LinkFlow'),START)['speed'])

    def test_missing_and_low_occupancy_break_runs(self):
        values=[sample(0),sample(1),None,sample(3),sample(4,occ=0),sample(5)]
        s=summarize(values,5,20)
        self.assertEqual(s['longest_run_samples'],2)
        self.assertEqual(s['longest_run_span_minutes'],5)
        self.assertTrue(s['first_run_left_censored'])
        self.assertEqual(s['valid'],5)
        self.assertEqual(s['expected'],6)

    def test_duplicate_or_large_time_gap_cannot_fake_continuity(self):
        for values in [[sample(0),sample(3)],[sample(0),sample(0)],[sample(1),sample(0)]]:
            self.assertEqual(summarize(values,5,20)['longest_run_samples'],0)

    def test_onset_thresholds_and_sparse_coverage(self):
        s=summarize([sample(0,50),sample(1),sample(2),None,None],5,20)
        self.assertFalse(s['first_run_left_censored']);self.assertFalse(s['eligible'])
        self.assertEqual(s['first_run_time'],sample(1)['time'])
        self.assertEqual(summarize([sample(0,20),sample(1,20)],5,20)['dense'],0)

    def test_link_join_not_vdid_only(self):
        vd=live(speed=30,volume=2)
        raw=gzip.compress(ET.tostring(vd))
        raw=gzip.compress(b'<VDLiveList>'+gzip.decompress(raw)+b'</VDLiveList>')
        self.assertEqual(parse_live(raw,{'test:b':{'vd_id':'test'}},START),{})
        self.assertEqual(parse_live(raw,{'test:a':{'vd_id':'test'}},START)['test:a']['speed'],30)

    def test_metadata_uses_published_mile_not_identifier_and_excludes_other_roads(self):
        def vd(ident):
            return f'<VD><VDID>{ident}</VDID><LocationMile>15K+830</LocationMile><PositionLon>121.60</PositionLon><PositionLat>25.07</PositionLat><DetectionLinks><DetectionLink><LinkID>x</LinkID></DetectionLink></DetectionLinks></VD>'
        raw=gzip.compress(('<VDList>'+vd('VD-N1-S-15.620-M-RS')+vd('VD-N3-S-15.620-M-RS')+vd('VD-N1-S-150.620-M-RS')+'</VDList>').encode())
        result=metadata(raw);self.assertEqual(len(result),1)
        self.assertEqual(next(iter(result.values()))['km'],15.83)

    def test_city_cadence_and_period_endpoints(self):
        times=slots('2026-10-15','am');self.assertEqual(len(times),31)
        self.assertEqual(times[-1].strftime('%H:%M'),'09:30')
        values=[sample(0),sample(3)]
        self.assertEqual(summarize(values,15,20)['longest_run_span_minutes'],15)
        self.assertEqual(len(times[::3]),11)

if __name__=='__main__':unittest.main()
