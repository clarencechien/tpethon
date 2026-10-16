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
 assert '32 輛出勤' in page.locator('#outcome-takeaway').text_content()
 # Default scenario, conservation and an adverse scenario must all be understandable.
 assert '減少 53%' in page.locator('#comparison-verdict').inner_text()
 assert '32 輛出勤' in page.locator('#comparison-verdict').inner_text()
 assert '12,000 人' in page.locator('#people-accounting').inner_text()
 assert '3,500 人' in page.locator('#people-accounting').inner_text()
 assert page.locator('#comparison-charts article').count()==4
 assert page.locator('#annual-chart article').count()==5
 assert page.locator('#weekly-chart .metric-row').count()==4
 # Keyboard operation must update results, including cases that worsen traffic.
 slider=page.locator('#report-conversion');slider.focus();slider.press('Home')
 assert page.locator('#conversion-value').inner_text()=='0%'
 assert '反而更塞' in page.locator('#comparison-verdict').inner_text()
 assert '0 人。加上' in page.locator('#people-accounting').inner_text()
 slider.press('ArrowRight')
 assert page.locator('#conversion-value').inner_text()=='5%'
 slider.fill('50');slider.dispatch_event('input')
 assert '減少 53%' in page.locator('#comparison-verdict').inner_text()
 page.locator('#report-year').select_option('4')
 assert '10,824' in page.locator('#growth-note').inner_text()
 page.locator('#reload-report').click()
 page.wait_for_function("!document.querySelector('#reload-report').disabled")
 assert page.locator('#report-year').input_value()=='4'
 assert page.locator('#report-conversion').input_value()=='50'
 page.screenshot(path='/tmp/neihu-report-desktop.png',full_page=True)
 page.set_viewport_size({'width':390,'height':844})
 assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
 page.screenshot(path='/tmp/neihu-report-mobile.png',full_page=True)
 page.locator('.report-actions a[href="map.html?view=today-am"]').click()
 page.wait_for_function("document.querySelector('#period').value==='am'")
 assert page.locator('#observation-date').input_value()==day
 assert '總覽報告' in page.locator('header nav').inner_text()
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
 assert missing.locator('#metro-total').inner_text()=='未知'
 assert '平均人次未知' in missing.locator('#metro-evidence').inner_text()
 assert missing.locator('#outcome-rows tr').count()==5
 # Large text and mobile navigation across the shared stylesheet's five consumers.
 for path in ['', 'map.html', 'plan.html', 'simulation.html', 'brt.html']:
  page.goto('http://127.0.0.1:8001/'+path)
  page.wait_for_load_state('networkidle')
  assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),path
  assert page.evaluate('parseFloat(getComputedStyle(document.querySelector("p")).fontSize)>=20'),path
  assert page.evaluate('parseFloat(getComputedStyle(document.querySelector(".fine")).fontSize)>=16'),path
  assert page.locator('header nav').get_by_text('資料與研究',exact=True).is_visible(),path
 assert not errors,errors
 print('PASS: report evidence, unknown vs missing, no scheduled run, growth assumptions, map navigation, desktop/mobile.')
 browser.close()
