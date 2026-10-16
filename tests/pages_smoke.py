"""Static map integration. Test-only observations are injected in memory, never published."""
import json
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright

now=datetime.now(ZoneInfo('Asia/Taipei'));day=now.date().isoformat()
def frame(time,speed):
    stamp=day+'T'+time+':00+08:00'
    rows=[dict(id='TEST:N',vd_id='TEST',link_id='N',name='測試堤頂大道',direction='N',bearing='N',lat=25.075,lon=121.57,speed=speed,occupancy=50 if speed<20 else 5,volume=10,active_lanes=1,lanes=1,status='0',timestamp=stamp),dict(id='TEST:S',vd_id='TEST',link_id='S',name='測試堤頂大道',direction='S',bearing='S',lat=25.075,lon=121.57,speed=40,occupancy=5,volume=10,active_lanes=1,lanes=1,status='0',timestamp=stamp)]
    return {'captured_at':stamp,'road':{'timestamp':stamp,'rows':rows}}
frames=[frame('07:01',10),frame('07:16',12),frame('07:31',40)]
current=frame(now.strftime('%H:%M'),10)
current['bus']={'rows':[],'timestamp':current['captured_at']}
fixture={'schema_version':1,'generated_at':current['captured_at'],'current':current,'frames':frames+[current]}
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/data/dashboard.json*',lambda route:route.fulfill(status=200,content_type='application/json',body=json.dumps(fixture)))
    page.goto('http://127.0.0.1:8001')
    page.wait_for_function("document.querySelector('#stat-valid').textContent.includes('/')")
    assert page.locator('#display').input_value()=='heat'
    assert page.locator('.leaflet-overlay-pane path').count()>0
    assert page.locator('.vd-marker').count()==0
    page.locator('#display').select_option('both')
    assert page.locator('.vd-marker').count()==2
    page.locator('#corridor').select_option('堤頂');page.locator('#direction').select_option('N')
    assert page.locator('.vd-marker').count()==1
    page.locator('#search').fill('DOES-NOT-EXIST')
    assert page.locator('.vd-marker').count()==0
    assert page.locator('#stat-hot').inner_text()=='—'
    page.locator('#search').fill('');page.locator('#corridor').select_option('');page.locator('#direction').select_option('')
    page.locator('#today-am').click()
    assert '歷史' in page.locator('#freshness').inner_text()
    assert page.locator('#snapshot-select option').count()>=3
    assert page.locator('.time-bin').count()==10
    before=page.locator('#snapshot-select').input_value()
    page.locator('#next-frame').click()
    assert page.locator('#snapshot-select').input_value()!=before
    page.locator('#previous-frame').click()
    assert page.locator('#snapshot-select').input_value()==before
    assert '15 分鐘' in page.locator('#gap-note').inner_text()
    if page.locator('.rank').count():
        page.locator('.rank').first.click()
        assert 'Link' in page.locator('#detail').inner_text()
        page.locator('.leaflet-popup-close-button').click()
    page.locator('#play').click();page.wait_for_timeout(1700)
    assert page.locator('#snapshot-select').input_value()!=before
    if page.locator('#play').inner_text()=='Ⅱ 暫停':page.locator('#play').click()
    page.locator('#yesterday-pm').click()
    assert '沒有資料' in page.locator('#freshness').inner_text()
    assert page.locator('#snapshot-select').is_disabled()
    assert page.locator('#play').is_disabled()
    assert page.locator('.vd-marker').count()==0
    assert page.locator('.leaflet-overlay-pane path').count()==0
    assert page.locator('#stat-hot').inner_text()=='—'
    assert '不能比較' in page.locator('#comparison-note').inner_text()
    page.locator('#view-latest').click()
    page.locator('#display').select_option('heat')
    page.locator('#metric').select_option('occupancy')
    assert '≥50%' in page.locator('#legend').inner_text()
    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(300)
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
    assert not errors,errors
    print('PASS: heat blocks, points, filters, dated periods, truthful no-data states, timeline, previous/next/play, metrics, mobile layout, no JS errors.')
    browser.close()
