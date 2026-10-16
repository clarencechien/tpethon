"""E1 observed heatmap, time/map selection, gaps, keyboard, mobile and failure state."""
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:8001/corridor.html')
    page.wait_for_function("document.querySelector('#experiment-period').disabled===false")
    assert '6,770' in page.locator('#experiment-summary').inner_text()
    assert page.locator('#experiment-period').input_value()=='2026-10-16-am'
    assert page.locator('#experiment-heatmap tbody tr').count()==8
    assert page.locator('#experiment-map .leaflet-interactive').count()==8
    page.locator('[data-preset="ramps"]').click()
    assert page.locator('#experiment-period').input_value()=='2026-10-15-pm'
    assert '成功路' in page.locator('#experiment-detail').inner_text()
    assert '17:15' in page.locator('#experiment-time-label').inner_text()
    page.locator('button.heat-cell[data-row="0"][data-time="6"]').click()
    assert '17:30' in page.locator('#experiment-time-label').inner_text()
    page.locator('#experiment-time').focus();page.keyboard.press('Home')
    assert '17:00' in page.locator('#experiment-time-label').inner_text()
    assert page.locator('#time-prev').is_disabled()
    page.locator('#experiment-group').select_option('city')
    assert page.locator('#city-road-field').is_visible()
    assert page.locator('.heat-cell.unsampled').count()>0
    page.locator('button.heat-cell[data-row="0"][data-time="1"]').click()
    assert '未抽樣' in page.locator('#experiment-detail').inner_text()
    assert '11 筆' in page.locator('#experiment-detail').inner_text()
    page.locator('#experiment-period').select_option('2026-10-16-am')
    assert '本實驗未收錄' in page.locator('#period-coverage').inner_text()
    assert page.locator('#experiment-heatmap tbody tr').count()==0
    assert page.locator('#experiment-map .leaflet-interactive').count()==0
    assert '8 組' in page.locator('#sensitivity-note').inner_text()
    assert '14 組' in page.locator('#sensitivity-note').inner_text()
    assert '21 組' in page.locator('#sensitivity-note').inner_text()
    page.locator('[data-preset="south"]').click()
    page.set_viewport_size({'width':390,'height':844})
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
    assert page.locator('#heatmap-wrap').evaluate('(e)=>e.scrollWidth>e.clientWidth')
    page.locator('#heatmap-wrap').evaluate('(e)=>e.scrollLeft=e.scrollWidth')
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
    page.screenshot(path='/tmp/neihu-corridor-mobile.png',full_page=True)
    page.set_viewport_size({'width':1440,'height':1000});page.screenshot(path='/tmp/neihu-corridor-desktop.png',full_page=True)
    bad=browser.new_page();bad.route('**/data/simulation/corridor-experiment.json',lambda route:route.fulfill(status=503,body='unavailable'))
    bad.goto('http://127.0.0.1:8001/corridor.html');bad.wait_for_selector('#experiment-error:visible')
    assert '503' in bad.locator('#experiment-error').inner_text()
    assert '無法確認結果' in bad.locator('#experiment-summary').inner_text()
    assert not errors,errors
    browser.close()
    print('PASS: E1 results, map/time selection, keyboard, city cadence and missing day, sensitivity, responsive scrolling, fetch failure')
