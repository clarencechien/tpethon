"""Exercise real simulation controls, invalidation, download and small-screen layout."""
import json
import os
from playwright.sync_api import sync_playwright

URL = os.environ.get('SIMULATION_TEST_URL', 'http://127.0.0.1:8001/simulation.html')
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_function("document.querySelectorAll('#simulation-results tr').length===6")
    page.locator('#reset-simulation').click()
    assert page.locator('#simulation-results tr').nth(1).locator('td').nth(3).inner_text() == '29'
    assert '移往外圍' in page.locator('#simulation-diagnosis').inner_text()
    assert page.locator('#simulation-sensitivity tr').count() == 3
    page.locator('#simulation-minute').fill('180')
    assert page.locator('#simulation-clock').inner_text() == '09:00'
    assert '0 PCU' != page.locator('#channel-outer strong').inner_text()
    page.locator('#simulation-choice').select_option('allbus')
    assert '10,000 人改搭巴士' in page.locator('#simulation-diagnosis').inner_text()
    with page.expect_download() as download:
        page.locator('#download-simulation').click()
    report = json.loads(open(download.value.path()).read())
    assert report['calibrated'] is False and report['selected'] == 'allbus'
    assert len(report['results']) == 6
    for r in report['results']:
        assert abs(r['carPeople'] + r['busPassengers'] - report['inputs']['people']) < 1e-6
    page.locator('#sim-people').fill('')
    page.wait_for_function("!document.querySelector('#simulation-error').hidden")
    assert page.locator('#simulation-results tr').count() == 0
    assert page.locator('#download-simulation').is_disabled()
    page.locator('#sim-people').fill('0')
    page.wait_for_function("document.querySelectorAll('#simulation-results tr').length===6")
    assert all(t == '0' for t in page.locator('#simulation-results tr').nth(5).locator('td').all_text_contents()[1:4])
    page.locator('#reset-simulation').click()
    page.locator('#simulation-choice').select_option('restrict')
    page.wait_for_function("document.querySelector('#evidence').textContent.includes('實測歷史到')")
    page.screenshot(path='/tmp/neihu-simulation-desktop.png', full_page=True)
    page.set_viewport_size({'width': 390, 'height': 844})
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
    page.screenshot(path='/tmp/neihu-simulation-mobile.png', full_page=True)
    assert not errors, errors
    missing = browser.new_page()
    missing.route('**/data/weeks/index.json', lambda route: route.fulfill(status=503, body='unavailable'))
    missing.goto(URL)
    missing.wait_for_function("document.querySelector('#evidence').textContent.includes('實測參考暫不可用')")
    assert missing.locator('#simulation-results tr').count() == 0
    missing.locator('#growth-mode').select_option('synthetic')
    missing.wait_for_function("document.querySelectorAll('#simulation-results tr').length===6")
    print('PASS: simulation scenarios, playback, assumptions export, invalid and zero input, mobile layout, and missing actual data.')
    browser.close()
