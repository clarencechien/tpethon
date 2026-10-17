import hashlib,json,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class HubPopulation(unittest.TestCase):
 def test_city_margins_are_not_double_counted_summary_rows(self):
  p=json.loads((ROOT/'data/simulation/hub-population.json').read_text())
  self.assertEqual(p['period'],'2026-09');self.assertEqual(len(p['districts']),61)
  self.assertEqual(len({(r['city'],r['district']) for r in p['districts']}),61)
  self.assertEqual({r['city'] for r in p['cities']},{'臺北市','新北市','基隆市','桃園市'})
  for city in p['cities']:
   for key in ['residents','households','male','female']:
    self.assertEqual(city[key],sum(r[key] for r in p['districts'] if r['city']==city['city']))
  for row in p['districts']:self.assertEqual(row['male']+row['female'],row['residents'])
 def test_residents_are_evidence_not_claimed_commuter_weights(self):
  raw=(ROOT/'data/simulation/hub-population.json').read_bytes();inputs=json.loads((ROOT/'data/simulation/hub-inputs.json').read_text())
  self.assertEqual(inputs['population_margins']['sha256'],hashlib.sha256(raw).hexdigest())
  self.assertFalse(inputs['population_margins']['used_as_commuter_weights'])
  self.assertFalse(inputs['calibrated'])
  for hub in inputs['hubs']:
   self.assertIsNone(hub['allocated_spaces']);self.assertFalse(hub['bus_stop_approved'])
