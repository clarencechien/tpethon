"""Report reading path, data gaps, scenario provenance and navigation."""
import json
from datetime import datetime
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright
now=datetime.now(ZoneInfo('Asia/Taipei'));day=now.date().isoformat()
frame={'captured_at':day+'T10:08:00+08:00','road':{'timestamp':day+'T10:07:00+08:00','rows':[]}}
fixture={'schema_version':1,'generated_at':day+'T14:00:00+08:00','current':{**frame,'bus':{'rows':[]}},'frames':[frame],
 'collection_status':{'publication_trigger':'push','checked_at':day+'T14:00:00+08:00','workflows':{'pages.yml':{'status':'no_scheduled_runs'},'weekly-data.yml':{'status':'unknown'}}}}
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1440,'height':1000});errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8001/')
 page.wait_for_function("document.querySelector('#outcome-rows').children.length===5 && document.querySelector('#weekly-evidence').textContent.includes('配對')")
 assert page.locator('#historical-date').inner_text()=='2026-10-15'
 assert '18,838' in page.locator('#metro-evidence').inner_text()
 assert page.locator('#hotspot-list article').count()>0
 assert '32 輛出勤' in page.locator('#outcome-takeaway').inner_text()
 page.locator('#report-year').select_option('4')
 assert '10,824' in page.locator('#growth-note').inner_text()
 page.locator('#reload-report').click()
 page.wait_for_function("!document.querySelector('#reload-report').disabled")
 assert page.locator('#report-year').input_value()=='4'
 page.screenshot(path='/tmp/neihu-report-desktop.png',full_page=True)
 page.set_viewport_size({'width':390,'height':844})
 assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
 page.screenshot(path='/tmp/neihu-report-mobile.png',full_page=True)
 page.locator('.report-actions a[href="map.html?view=today-am"]').click()
 page.wait_for_function("document.querySelector('#period').value==='am'")
 assert page.locator('#observation-date').input_value()==day
 assert '總覽報告' in page.locator('nav').inner_text()
 bad=browser.new_page();bad.route('**/data/dashboard.json',lambda r:r.fulfill(status=200,content_type='application/json',body=json.dumps(fixture)))
 bad.goto('http://127.0.0.1:8001/')
 bad.wait_for_function("document.querySelector('#morning-coverage').textContent==='0 / 10 格'")
 assert '10:07' in bad.locator('#availability-reason').inner_text()
 bad.locator('summary').first.click()
 assert '尚查無定時觸發' in bad.locator('#schedule-health').inner_text()
 assert '程式／資料推送' in bad.locator('#publication-meta').inner_text()
 missing=browser.new_page();missing.route('**/data/dashboard.json',lambda r:r.fulfill(status=503,body='unavailable'));missing.route('**/data/metro.json',lambda r:r.fulfill(status=503,body='unavailable'))
 missing.goto('http://127.0.0.1:8001/')
 missing.wait_for_function("document.querySelector('#morning-coverage').textContent==='未知'")
 assert '平均人次未知' in missing.locator('#metro-evidence').inner_text()
 assert missing.locator('#outcome-rows tr').count()==5
 assert not errors,errors
 print('PASS: report evidence, unknown vs missing, no scheduled run, growth assumptions, map navigation, desktop/mobile.')
 browser.close()
