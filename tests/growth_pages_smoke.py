"""Observed shape selection, independent growth bases, and reproducible export."""
import json
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://127.0.0.1:8001/simulation.html')
    page.wait_for_function("document.querySelectorAll('#growth-years-table tr').length===6")
    assert '已套用' in page.locator('#growth-source').inner_text()
    assert '18,838.14' in page.locator('#growth-metro-source').inner_text()
    assert '11,041' in page.locator('#simulation-summary').inner_text()
    assert page.locator('#sim-people').input_value() == '10000'  # Baseline never overwritten.
    assert page.locator('#growth-volume-chart circle').count() == 20
    page.locator('#growth-period').select_option('pm')
    page.wait_for_function("document.querySelector('#simulation-summary').textContent.includes('17:00–19:30')")
    page.locator('#simulation-minute').fill('180')
    assert page.locator('#simulation-clock').inner_text() == '19:00'
    page.locator('#growth-years').fill('0')
    page.wait_for_function("document.querySelectorAll('#growth-years-table tr').length===1")
    assert '10,000' in page.locator('#simulation-summary').inner_text()
    page.locator('#growth-years').fill('5')
    page.wait_for_function("document.querySelectorAll('#growth-years-table tr').length===6")
    assert '11,041' in page.locator('#simulation-summary').inner_text()
    with page.expect_download() as event:
        page.locator('#download-simulation').click()
    with open(event.value.path()) as f: report = json.load(f)
    assert report['base_inputs']['people'] == 10000 and report['inputs']['people'] == 11041
    assert report['input_type'] == 'observed_shape_with_assumed_magnitude_and_growth'
    assert report['growth']['profile']['start_minute'] == 1020
    assert len(report['inputs']['demandWeights']) == 150
    assert report['growth']['metro']['base_mean'] == 414439 / 22
    assert report['growth']['profile']['descriptor']['sha256']
    page.locator('#growth-rate').fill('-2')
    page.wait_for_function("document.querySelector('#simulation-summary').textContent.includes('9,039')")
    page.locator('#growth-rate').fill('')
    page.wait_for_function("!document.querySelector('#simulation-error').hidden")
    assert page.locator('#simulation-results tr').count() == 0
    assert page.locator('#growth-years-table tr').count() == 0
    assert page.locator('#download-simulation').is_disabled()
    page.locator('#growth-rate').fill('2'); page.locator('#growth-period').select_option('am')
    page.wait_for_function("document.querySelectorAll('#simulation-results tr').length===6")
    page.screenshot(path='/tmp/neihu-growth-desktop.png', full_page=True)
    page.set_viewport_size({'width': 390, 'height': 844})
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
    page.screenshot(path='/tmp/neihu-growth-mobile.png', full_page=True)
    assert not errors, errors
    # A corrupt profile is not silently turned into synthetic or zero demand.
    bad = browser.new_page(); bad.route('**/data/weeks/profiles.json', lambda r: r.fulfill(status=200, body='{}'))
    bad.goto('http://127.0.0.1:8001/simulation.html')
    bad.wait_for_function("document.querySelector('#simulation-error').textContent.includes('版本不一致')")
    assert bad.locator('#simulation-results tr').count() == 0
    # Metro failure remains unknown, while road shape projection remains usable.
    absent = browser.new_page(); absent.route('**/data/metro.json', lambda r: r.fulfill(status=503, body='unavailable'))
    absent.goto('http://127.0.0.1:8001/simulation.html')
    absent.wait_for_function("document.querySelectorAll('#growth-years-table tr').length===6")
    assert absent.locator('#growth-years-table tr').first.locator('td').last.inner_text() == '—'
    print('PASS: observed AM/PM shapes, compound and negative growth, unchanged baseline, export provenance, invalid data, missing metro, mobile.')
    browser.close()
