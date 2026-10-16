import gzip
from datetime import datetime
import unittest
from scripts.prepare_service_experiments import ramp_observation, VD, LINK

class RampInputsTest(unittest.TestCase):
    def raw(self,volume='0',speed='0',status='0',stamp='2026-10-14T17:00:00+08:00',link=LINK):
        return gzip.compress(f'<VDLiveList><VDLive><VDID>{VD}</VDID><Status>{status}</Status><DataCollectTime>{stamp}</DataCollectTime><LinkFlow><LinkID>{link}</LinkID><Lane><Speed>{speed}</Speed><Occupancy>0</Occupancy><Vehicle><VehicleType>S</VehicleType><Volume>{volume}</Volume></Vehicle></Lane></LinkFlow></VDLive></VDLiveList>'.encode())
    def test_zero_flow_is_kept_without_calling_it_a_standing_queue(self):
        row=ramp_observation(self.raw(),datetime.fromisoformat('2026-10-14T17:00:00+08:00'))
        self.assertEqual(row['volume'],0);self.assertIsNone(row['speed'])
    def test_missing_negative_stale_and_wrong_links_are_not_zero(self):
        stamp=datetime.fromisoformat('2026-10-14T17:00:00+08:00')
        for raw in [self.raw(volume='-1'),self.raw(status='2'),self.raw(stamp='2026-10-14T16:50:00+08:00'),self.raw(link='wrong')]:
            self.assertIsNone(ramp_observation(raw,stamp)['volume'])

if __name__=='__main__':unittest.main()
