"""Read public workflow evidence; never equate configured cron with a successful run."""
import json
import os
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

REPOSITORY = 'clarencechien/tpethon'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Unexpected GitHub API redirect')


def summarize_runs(payload):
    runs = [r for r in payload['workflow_runs'] if r.get('event') == 'schedule']
    runs.sort(key=lambda r: r.get('created_at', ''), reverse=True)
    def brief(r):
        return {key: r.get(key) for key in ('id', 'created_at', 'status', 'conclusion')}
    successful = next((r for r in runs if r.get('conclusion') == 'success'), None)
    return {'status': 'observed' if runs else 'no_scheduled_runs',
            'latest': brief(runs[0]) if runs else None,
            'last_success_in_recent_runs': brief(successful) if successful else None}


def collect_status():
    result = {'checked_at': datetime.now(ZoneInfo('Asia/Taipei')).isoformat(timespec='seconds'), 'workflows': {}}
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'tpethon-data-health'}
    token = os.environ.get('GITHUB_TOKEN')
    if token:
        headers['Authorization'] = 'Bearer ' + token
    opener = urllib.request.build_opener(NoRedirect)
    for name in ('pages.yml', 'weekly-data.yml'):
        url = f'https://api.github.com/repos/{REPOSITORY}/actions/workflows/{name}/runs?event=schedule&per_page=30'
        try:
            with opener.open(urllib.request.Request(url, headers=headers), timeout=15) as response:
                payload = json.load(response)
            result['workflows'][name] = summarize_runs(payload)
        except Exception:
            result['workflows'][name] = {'status': 'unknown', 'latest': None, 'last_success_in_recent_runs': None}
    result['publication_trigger'] = os.environ.get('GITHUB_EVENT_NAME', 'local_build')
    return result
