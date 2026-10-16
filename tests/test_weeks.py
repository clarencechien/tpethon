import tempfile
import unittest
from datetime import date
from pathlib import Path
from scripts.summarize_weeks import build,comparison,summarize_day

def day(name,speeds):
    return dict(day=name,sensors=[dict(id='A',name='Test road',direction='N'),dict(id='B',name='Test road',direction='S')],columns=['sensor','speed','occupancy','volume','active_lanes','status'],
      frames=[[f'{name}T{m//60:02}:{m%60:02}:00+08:00',[[i,s,50,3,1,'0'] for i,s in enumerate(speeds)]] for m in range(420,570,15)],counts={'input_records':100},sources={})

class WeeklyTests(unittest.TestCase):
    def test_missing_day_is_not_zero_congestion(self):
        import json
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory);raw=folder/'input';raw.mkdir();(raw/'2026-10-15.json').write_text(json.dumps(day('2026-10-15',[10,50])))
            result=build(date(2026,10,16),raw,folder/'output')
            self.assertEqual([w['available_days'] for w in result['weeks']],[0,1])
            self.assertIsNone(result['matched_weekdays']['am']['difference_percentage_points'])
            current=json.loads((folder/'output/2026-10-12.json').read_text())
            self.assertEqual(current['days'][4]['status'],'not_yet_published');self.assertEqual(current['days'][5]['status'],'future')
            self.assertEqual(current['periods']['am']['slow_share'],.5)
    def test_matched_comparison_uses_common_valid_stations_only(self):
        a=day('2026-10-05',[10,50]);b=day('2026-10-12',[40,10])
        for f in b['frames']:f[1][1][-1]='3'
        result=comparison(['2026-10-05'],['2026-10-12'],{a['day']:a,b['day']:b})['am']
        self.assertEqual(result['paired_observations'],10)
        self.assertEqual(result['previous']['slow_share'],1);self.assertEqual(result['current']['slow_share'],0)
        self.assertEqual(result['difference_percentage_points'],-100)
    def test_low_coverage_pairs_are_not_used(self):
        a=day('2026-10-05',[10]);b=day('2026-10-12',[40]);b['frames']=b['frames'][:3]
        result=comparison([a['day']],[b['day']],{a['day']:a,b['day']:b})['am']
        self.assertEqual(result['day_pairs'],[]);self.assertIsNone(result['difference_percentage_points'])
    def test_zero_volume_is_not_accumulated_as_vehicle_demand(self):
        summary=summarize_day(day('2026-10-15',[10,40]));self.assertNotIn('total_flow',summary)
        self.assertEqual(summary['periods']['am']['slow_share'],.5)
