"""E13 must expose its stopping decision and absolute punctuality, including failures."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://127.0.0.1:8001/holding.html')
    page.wait_for_selector('#holding-content:visible')
    assert '16／100' in page.locator('#holding-stop-verdict').inner_text()
    assert '18／100' in page.locator('#holding-stop-verdict').inner_text()
    assert '44人' in page.locator('#holding-audit-verdict').inner_text()
    assert page.locator('#holding-summary tbody tr').count() == 4
    assert page.locator('#holding-detail tbody tr').count() == 4
    for width in (390, 1440):
        page.set_viewport_size({'width': width, 'height': 1000})
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
        assert page.locator('.intro p').evaluate('(e)=>parseFloat(getComputedStyle(e).fontSize)') >= 20
        page.locator('#stop').scroll_into_view_if_needed()
        page.screenshot(path=f'/tmp/holding-stop-{width}.png')
        page.locator('#audit').scroll_into_view_if_needed()
        page.screenshot(path=f'/tmp/holding-audit-{width}.png')
    before = page.locator('#holding-detail').inner_text()
    page.locator('#holding-walk').select_option('6')
    assert before != page.locator('#holding-detail').inner_text()
    page.locator('#holding-condition').select_option('severe')
    assert '0%–0%' in page.locator('#holding-context').inner_text() or '0.0%–0.0%' in page.locator('#holding-context').inner_text()
    assert page.locator('#holding-detail tbody').inner_text().count('0／10') == 4
    page.locator('#holding-condition').select_option('nominal')
    assert '10／10' in page.locator('#holding-detail').inner_text()
    bad = browser.new_page()
    bad.route('**/holding-results.json', lambda r: r.fulfill(status=503, body='unavailable'))
    bad.goto('http://127.0.0.1:8001/holding.html')
    bad.wait_for_selector('#holding-error:visible')
    assert bad.locator('#holding-content').is_hidden()
    page.goto('http://127.0.0.1:8001/experiments.html')
    page.locator('.experiment-open[href="holding.html"]').click()
    page.wait_for_selector('#holding-content:visible')
    assert not errors, errors
    browser.close()
    print('PASS E13 stop decision, absolute punctuality, paired harms, controls, mobile and missing data')
