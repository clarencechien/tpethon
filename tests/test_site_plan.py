import hashlib
import json
import unittest
from pathlib import Path
from scripts.prepare_site_plan import distance, reference_segment
ROOT=Path(__file__).resolve().parents[1]
class SitePlan(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data=json.loads((ROOT/'data/simulation/site-plan.json').read_text())
    def test_source_totals_never_become_allocated_or_available_capacity(self):
        rows=self.data['facilities'];self.assertEqual(len(rows),8)
        self.assertEqual(sum(r['large_vehicle_bays']>0 for r in rows),5)
        for r in rows:
            self.assertIsNone(r['available_bays']);self.assertEqual(r['contracted_bays'],0)
            self.assertFalse(r['entrance_verified']);self.assertFalse(r['driver_restroom_verified'])
        ids={r['id']:r for r in rows}
        self.assertEqual(ids['TPE1956']['large_vehicle_bays'],53)
        self.assertEqual(ids['TPE1964']['large_vehicle_bays'],30)
        self.assertNotEqual(ids['TPE1956']['coordinates'],ids['TPE1964']['coordinates'])
        for ident in ['TPE0654','TPE0627','TPE0442']:
            self.assertEqual(ids[ident]['status'],'excluded');self.assertEqual(ids[ident]['large_vehicle_bays'],0)
    def test_coordinates_are_wgs84_data_points_not_certified_gate_locations(self):
        for r in self.data['facilities']:
            lon,lat=r['coordinates'];self.assertTrue(121.5<lon<121.7 and 25<lat<25.2)
            self.assertGreater(float(r['source_xy'][0]),300000)
            self.assertIn('不是已核對入口',r['coordinate_basis'])
        # Independent cross-check with official entrance records for three car parks.
        entrances={'TPE0654':[121.5694,25.0797],'TPE0627':[121.5753,25.0784],'TPE0442':[121.5737,25.0762]}
        for r in self.data['facilities']:
            if r['id'] in entrances:self.assertLess(distance(r['coordinates'],entrances[r['id']]),100)
    def test_directional_stops_and_unknown_connection_segments_are_preserved(self):
        for p in self.data['plans']:
            self.assertNotEqual(p['boarding_start']['StopUID'],p['return_terminal']['StopUID'])
            self.assertEqual(len(p['proposed_stops']),5)
            self.assertEqual(p['proposed_stops'][-1]['StopName']['Zh_tw'],'時報廣場')
            self.assertEqual(len(p['gaps']),3)
            for g in p['gaps']:
                self.assertIsNone(g['road_distance_m']);self.assertFalse(g['bus_access_verified'])
                car=g['car_reference']
                self.assertEqual(car['profile'],'driving');self.assertFalse(car['bus_access_verified'])
                self.assertFalse(car['bearing_constrained'])
                self.assertEqual(car['geometry']['type'],'LineString')
                self.assertGreater(car['distance_m'],0)
                self.assertTrue(car['source']['url'].startswith('https://router.project-osrm.org/route/v1/driving/'))
                self.assertEqual(len(car['source']['sha256']),64)
            for k in ['outbound_reference','return_reference']:
                self.assertTrue(p[k]['reference_only']);self.assertLess(max(p[k]['snap_offsets_m']),150)
                self.assertGreater(p[k]['length_m'],1500)
        self.assertFalse(self.data['readiness']['ready_to_operate'])
    def test_no_ambiguous_reverse_or_far_geometry_is_invented(self):
        route={'reference_geometry':{'coordinates':[[121.57,25.08],[121.58,25.07]]}}
        a={'StopPosition':{'PositionLon':121.57,'PositionLat':25.08}}
        b={'StopPosition':{'PositionLon':121.58,'PositionLat':25.07}}
        self.assertRaises(ValueError,reference_segment,route,b,a)
        far={'StopPosition':{'PositionLon':121.7,'PositionLat':25.2}}
        self.assertRaises(ValueError,reference_segment,route,a,far)
    def test_route_snapshot_and_operator_caveats_have_traceable_sources(self):
        raw=(ROOT/'data/simulation/route-candidates.json').read_bytes()
        self.assertEqual(self.data['route_input_sha256'],hashlib.sha256(raw).hexdigest())
        ops={r['nameZh']:r for r in self.data['operators']}
        self.assertEqual(ops['藍26']['providerName'],'三重客運')
        self.assertIn('平常日停駛',ops['紅3']['headwayDesc'])
        self.assertTrue(self.data['as_of'].endswith('+08:00'))
