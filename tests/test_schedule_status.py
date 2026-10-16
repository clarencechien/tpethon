import unittest
from scripts.schedule_status import summarize_runs

class ScheduleStatusTests(unittest.TestCase):
    def test_push_success_does_not_prove_scheduled_collection(self):
        self.assertEqual(summarize_runs({'workflow_runs':[{'event':'push','conclusion':'success'}]})['status'],'no_scheduled_runs')

    def test_latest_failure_preserves_last_scheduled_success(self):
        result=summarize_runs({'workflow_runs':[
            {'id':1,'event':'schedule','created_at':'2026-10-16T03:07:00Z','status':'completed','conclusion':'success'},
            {'id':2,'event':'schedule','created_at':'2026-10-16T03:22:00Z','status':'completed','conclusion':'failure'}]})
        self.assertEqual(result['latest']['conclusion'],'failure')
        self.assertEqual(result['last_success_in_recent_runs']['id'],1)
