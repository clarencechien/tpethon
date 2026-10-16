"""Exercise actual committed history, failed downloads, and rapid date changes."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:8001')
    page.wait_for_function("document.querySelector('#archive-day').options.length>1")
    page.locator('#archive-day').select_option('2026-10-15')
    page.wait_for_function("document.querySelector('#snapshot-select').options.length===10 && !document.querySelector('#snapshot-select').disabled")
    assert '10/10' in page.locator('#selection-note').inner_text()
    assert '10/15' in page.locator('#source-time').inner_text()
    assert '歷史' in page.locator('#freshness').inner_text()
    assert page.locator('.leaflet-overlay-pane path').count()>0
    assert page.locator('#archive-download').get_attribute('href')=='./data/history/2026-10-15.json'
    page.locator('#period').select_option('pm')
    page.wait_for_function("document.querySelector('#time-label').textContent.includes('17:00')")
    assert page.locator('#snapshot-select option').count()==10
    before=page.locator('#snapshot-select').input_value();page.locator('#next-frame').click()
    assert page.locator('#snapshot-select').input_value()!=before
    assert '15 分鐘' in page.locator('#gap-note').inner_text()
    page.screenshot(path='/tmp/neihu-github-history-desktop.png',full_page=True)
    page.locator('#observation-date').fill('2026-10-14');page.locator('#observation-date').dispatch_event('change')
    page.wait_for_function("document.querySelector('#snapshot-select').disabled")
    assert page.locator('.leaflet-overlay-pane path').count()==0
    assert page.locator('#stat-hot').inner_text()=='—'
    page.locator('#view-latest').click()
    assert '10/16' in page.locator('#source-time').inner_text()
    page.set_viewport_size({'width':390,'height':844})
    page.locator('#archive-day').select_option('2026-10-15')
    page.wait_for_function("document.querySelector('#snapshot-select').options.length===10 && !document.querySelector('#snapshot-select').disabled")
    page.screenshot(path='/tmp/neihu-github-history-mobile.png',full_page=True)
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
    assert not errors,errors
    # A failed data file must be distinguishable from a day with no congestion.
    bad=browser.new_page();bad.route('**/data/history/2026-10-15.json',lambda route:route.fulfill(status=503,body='unavailable'))
    bad.goto('http://127.0.0.1:8001');bad.wait_for_function("document.querySelector('#archive-day').options.length>1")
    bad.locator('#archive-day').select_option('2026-10-15')
    bad.wait_for_function("document.querySelector('#archive-status').textContent.includes('503')")
    assert bad.locator('#stat-hot').inner_text()=='—'
    assert bad.locator('#snapshot-select').is_disabled()
    print('PASS: real GitHub day loads, AM/PM coverage, replay, downloads, absent dates, latest restored, mobile, failed archive visible.')
    browser.close()
