"""Dependency-free Taipei mobility dashboard; no synthetic fallback for actual data."""
import csv
from live import snapshot
import io
import json
import math
import os
import threading
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).parent
DATA = ROOT / 'local-data'
TZ = ZoneInfo('Asia/Taipei')
LOCK = threading.Lock()

def parse_csv(text):
    reader = csv.DictReader(io.StringIO(text.lstrip('\ufeff')))
    required = {'mode', 'timestamp', 'location', 'metric', 'value', 'interval_minutes', 'source'}
    if not required.issubset(reader.fieldnames or []):
        raise ValueError('缺少欄位：' + ', '.join(sorted(required - set(reader.fieldnames or []))))
    rows, seen = [], set()
    for line, r in enumerate(reader, 2):
        if len(rows) >= 100000:
            raise ValueError('最多可匯入 100,000 筆')
        mode, metric = r['mode'].strip(), r['metric'].strip()
        allowed = {'road': {'vehicles', 'speed_kph'}, 'bus': {'arrivals', 'boardings'}, 'metro': {'entries', 'exits'}}
        if mode not in allowed or metric not in allowed[mode]:
            raise ValueError(f'第 {line} 行：運具與指標不相容')
        dt = datetime.fromisoformat(r['timestamp'])
        if dt.tzinfo is None:
            raise ValueError(f'第 {line} 行：時間必須含時區，例如 +08:00')
        dt = dt.astimezone(TZ)
        value, interval = float(r['value']), int(r['interval_minutes'])
        if not math.isfinite(value) or value < 0 or interval not in (5, 15, 60):
            raise ValueError(f'第 {line} 行：數值需非負，區間需為 5、15 或 60 分鐘')
        if dt.second or dt.microsecond or dt.minute % interval:
            raise ValueError(f'第 {line} 行：時間需對齊統計區間起點')
        if not r['location'].strip() or not r['source'].strip():
            raise ValueError(f'第 {line} 行：地點與來源不可空白')
        key = (mode, dt.isoformat(), r['location'], metric)
        if key in seen:
            raise ValueError(f'第 {line} 行：相同地點、時間、指標重複')
        seen.add(key)
        rows.append(dict(mode=mode, timestamp=dt.isoformat(), location=r['location'].strip(), metric=metric, value=value, interval=interval, source=r['source'].strip()))
    if not rows:
        raise ValueError('CSV 沒有資料')
    # Overlapping windows would inflate totals; reject rather than guess.
    groups = {}
    for row in sorted(rows, key=lambda x:x['timestamp']):
        key = (row['mode'], row['location'], row['metric'])
        start = datetime.fromisoformat(row['timestamp']).timestamp()
        if start < groups.get(key, 0):
            raise ValueError('相同地點與指標的統計區間重疊')
        groups[key] = start + row['interval'] * 60
    return rows

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'static'), **kwargs)

    def respond(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/api/live':
            return self.respond(snapshot())
        if self.path == '/api/metro':
            path = DATA / 'metro.json'
            return self.respond(json.loads(path.read_text()) if path.exists() else {'rows': [], 'error': '尚未下載捷運月資料，請執行 python metro.py'})
        if self.path == '/api/data':
            path = DATA / 'observations.json'
            return self.respond(json.loads(path.read_text()) if path.exists() else [])
        if self.path == '/api/health':
            return self.respond({'status': 'ok'})
        return super().do_GET()

    def do_POST(self):
        if self.path != '/api/import':
            return self.respond({'error': 'Not found'}, 404)
        # Local dev tool: reject cross-origin browser writes.
        origin = self.headers.get('Origin')
        if origin and origin != 'http://' + self.headers.get('Host', ''):
            return self.respond({'error': '跨來源匯入不允許'}, 403)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 10_000_000:
                raise ValueError('CSV 大小需介於 1 byte 與 10 MB')
            rows = parse_csv(self.rfile.read(length).decode('utf-8-sig'))
            with LOCK:
                DATA.mkdir(exist_ok=True)
                temp = DATA / 'observations.tmp'
                temp.write_text(json.dumps(rows, ensure_ascii=False))
                temp.replace(DATA / 'observations.json')
            return self.respond({'count': len(rows)})
        except (ValueError, UnicodeError) as error:
            return self.respond({'error': str(error)}, 400)

if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', int(os.environ.get('PORT', '8000'))), Handler).serve_forever()
