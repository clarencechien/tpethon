import hashlib
import json
import unittest
from pathlib import Path
from scripts.prepare_route_candidates import line_geometry
ROOT=Path(__file__).resolve().parents[1]
class RouteCandidates(unittest.TestCase):
    def test_invalid_geometry_stays_unknown(self):
        for value in [None,'POLYGON((121 25,121 25))','LINESTRING(121 25)','LINESTRING(nan 25,121 25)','LINESTRING(25 121,25 121)','LINESTRING(a b,121 25)']:
            self.assertIsNone(line_geometry(value))
        self.assertEqual(line_geometry('LINESTRING (121.5 25.0,121.6 25.1)')['coordinates'],[[121.5,25.0],[121.6,25.1]])
    def test_no_route_level_shape_is_pretended_to_be_a_subroute_path(self):
        artifact=json.loads((ROOT/'data/simulation/route-candidates.json').read_text())
        raw=(ROOT/'data/simulation/candidate-bus-stops.json').read_bytes()
        self.assertEqual(artifact['stops_sha256'],hashlib.sha256(raw).hexdigest())
        self.assertEqual(len(artifact['routes']),14)
        for actual,expected in zip(artifact['routes'],json.loads(raw)):
            self.assertEqual(actual['Stops'],expected['Stops'])
            self.assertEqual(actual['SubRouteUID'],expected['SubRouteUID'])
            self.assertIsNone(actual['geometry'])
            self.assertEqual(actual['geometry_status'],'unmatched')
            self.assertIsNotNone(actual['reference_geometry'])
