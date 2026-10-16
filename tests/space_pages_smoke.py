"""Field capacity, residual passengers, custom worker calculations, mobile, failures."""
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:8001/space.html');page.wait_for_selector('#space-output:visible')
    assert page.locator('#space-comparison tbody tr').count()==8
    assert '10.5 分一班' in page.locator('#space-verdict').inner_text()
    assert '0 / 22 天' in page.locator('#space-verdict').inner_text()
    assert '36 格' in page.locator('#space-parking').inner_text()
    assert page.locator('#space-day').input_value()=='2026-09-15'
    assert page.locator('#space-phase').input_value()=='0.5'
    page.locator('#space-case').select_option('six')
    assert '22 / 22 天' in page.locator('#space-verdict').inner_text()
    assert '20%' in page.locator('#space-envelope').inner_text()
    page.locator('#space-restspaces').fill('5');page.locator('#run-space').click();page.wait_for_selector('#space-output:visible',timeout=60000)
    assert '22 / 22 天' in page.locator('#space-verdict').inner_text()
    page.locator('#space-case').select_option('remote')
    assert '3 分一班' in page.locator('#space-verdict').inner_text()
    assert '15%' in page.locator('#space-envelope').inner_text()
    page.locator('#space-time').fill('30');page.locator('#space-time').dispatch_event('input')
    assert page.locator('#space-time-label').inner_text()=='08:00'
    page.locator('#space-day').select_option('2026-09-01');page.locator('#space-phase').select_option('5.5')
    assert '2026-09-01' in page.locator('#space-day-note').inner_text()
    assert '5.5 分鐘' in page.locator('#space-day-note').inner_text()
    page.locator('#space-restspaces').fill('0');assert page.locator('#space-output').is_hidden()
    page.locator('#run-space').click();page.wait_for_selector('#space-output:visible',timeout=60000)
    assert '沒有符合車數' in page.locator('#space-verdict').inner_text()
    assert '未有人離站' in page.locator('#space-metrics').inner_text()
    page.locator('#space-restspaces').fill('');page.locator('#run-space').click()
    assert page.locator('#space-output').is_hidden();assert '空白不代表零' in page.locator('#space-input-error').inner_text()
    page.locator('#space-case').select_option('six')
    page.locator('#space-share').fill('0');page.locator('#run-space').click();page.wait_for_selector('#space-output:visible',timeout=60000)
    assert '0 人估計需要接駁' in page.locator('#space-day-note').inner_text()
    assert '未有人離站' in page.locator('#space-metrics').inner_text()
    page.locator('#space-case').select_option('one')
    for width in [390,1440]:
        page.set_viewport_size({'width':width,'height':1000})
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
        assert page.locator('#comparison > p').first.evaluate('(e)=>parseFloat(getComputedStyle(e).fontSize)')>=20
        page.locator('#space-verdict').evaluate("e=>e.scrollIntoView({block:'start'})");page.screenshot(path=f'/tmp/space-results-{width}.png')
        page.locator('#space-queue-chart').evaluate("e=>e.scrollIntoView({block:'start'})");page.screenshot(path=f'/tmp/space-queue-{width}.png')
    bad=browser.new_page();bad.route('**/space-experiment.json',lambda r:r.fulfill(status=503,body='unavailable'))
    bad.goto('http://127.0.0.1:8001/space.html');bad.wait_for_selector('#space-error:visible')
    assert bad.locator('#space-output').is_hidden();assert bad.locator('#run-space').is_disabled()
    assert not errors,errors
    browser.close();print('PASS: space constraints, parked fleet, remote tradeoff, worker, input validation, date/phase, zero demand, residual demand, mobile layout, data failure')
