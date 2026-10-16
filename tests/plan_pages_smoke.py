"""Weekly-summary and capacity-plan functional checks against a local Pages build."""
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:8001/plan.html')
    page.wait_for_function("document.querySelectorAll('#daily-rows tr').length===14")
    assert page.locator('#week-cards .week-card').count()==2
    assert '觀測差異' in page.locator('#matched-comparison').inner_text()
    page.locator('#daily-details > summary').click()
    assert page.locator('#daily-rows').inner_text().count('未核對')==14
    page.locator('#week-period').select_option('pm')
    assert not page.locator('#weekly-error').is_visible()
    page.locator('#shift').fill('100')
    assert page.locator('#scenario-results strong').nth(3).inner_text()=='119'
    page.locator('#cycle').fill('120')
    assert page.locator('#scenario-results strong').nth(3).inner_text()=='159'
    page.locator('#shift').fill('0')
    assert all(value=='0' for value in page.locator('#scenario-results strong').all_text_contents()[:5])
    page.locator('#bus-assumptions > summary').click()
    page.locator('#load').fill('0')
    assert page.locator('#scenario-error').is_visible();assert page.locator('#scenario-results strong').count()==0
    page.locator('#load').fill('80');page.locator('#shift').fill('20');page.locator('#cycle').fill('90')
    page.wait_for_function("document.querySelectorAll('#readiness .readiness-row').length>0")
    page.locator('#readiness-details > summary').click()
    assert '待補' in page.locator('#readiness').inner_text()
    page.screenshot(path='/tmp/neihu-week-plan-desktop.png',full_page=True)
    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(100)
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
    page.screenshot(path='/tmp/neihu-week-plan-mobile.png',full_page=True)
    assert not errors,errors
    bad=browser.new_page();bad.route('**/data/weeks/index.json',lambda r:r.fulfill(status=503,body='unavailable'));bad.goto('http://127.0.0.1:8001/plan.html')
    bad.wait_for_function("!document.querySelector('#weekly-error').hidden")
    assert '503' in bad.locator('#weekly-error').inner_text()
    assert bad.locator('#daily-rows tr').count()==0
    assert bad.locator('#scenario-results strong').count()==6
    print('PASS: weekly actuals, matched comparison, missing-weather labels, capacity and cycle response, zero/invalid cases, mobile, failed weekly fetch distinct from plan.')
    browser.close()
