"""E9 browser verification: presets, worker, paired harm, exports and reading layout."""
import json
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://127.0.0.1:8001/repairs.html')
    page.wait_for_selector('#repair-content:visible')
    assert page.locator('#repair-table tbody tr').count() == 6
    assert '沒有可接受的預約' in page.locator('#repair-verdict').inner_text()
    assert '797' in page.locator('#repair-baseline').inner_text()
    assert '4／72' in page.locator('#repair-stress').inner_text()

    def run():
        page.locator('#repair-run').click()
        page.wait_for_function("!document.getElementById('repair-run').disabled")

    page.locator('[data-preset="candidate"]').click()
    page.wait_for_function("document.getElementById('repair-status').textContent.includes('已更新')")
    assert '55 名原開車者轉乘' in page.locator('#repair-verdict').inner_text()
    assert '減少 592 公里' in page.locator('#repair-verdict').inner_text()
    assert page.locator('#repair-lines tbody tr').count() == 4
    for width in (390, 1440):
        page.set_viewport_size({'width': width, 'height': 1000})
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
        assert page.locator('.intro p').evaluate('(e)=>parseFloat(getComputedStyle(e).fontSize)') >= 20
        page.locator('#comparison').scroll_into_view_if_needed()
        page.screenshot(path=f'/tmp/repairs-{width}.png')
    page.locator('[data-preset="stress"]').click()
    page.wait_for_function("!document.getElementById('repair-run').disabled")
    assert '新增晚到 18 人' in page.locator('#repair-verdict').inner_text()
    assert '12時未完成 5 人' in page.locator('#repair-verdict').inner_text()
    with page.expect_download() as download:
        page.locator('#repair-download').click()
    payload = json.loads(open(download.value.path()).read())
    assert payload['result']['options']['actualSpeedFactor'] == .85
    assert len(payload['model_sha256']) == 64
    assert next(r for r in payload['result']['results'] if r['id'] == 'reserved')['newlyLate'] == 18
    page.locator('[name="fleet"]').select_option('0')
    run()
    assert '沒有可接受的預約' in page.locator('#repair-verdict').inner_text()
    page.locator('#repair-form summary').click()
    page.locator('[name="participation"]').select_option('0')
    run()
    assert 'NaN' not in page.locator('#repair-content').inner_text()
    assert '新增晚到 0 人' in page.locator('#repair-verdict').inner_text()
    bad = browser.new_page()
    bad.route('**/repair-results.json', lambda r: r.fulfill(status=503, body='unavailable'))
    bad.goto('http://127.0.0.1:8001/repairs.html')
    bad.wait_for_selector('#repair-error:visible')
    assert bad.locator('#repair-content').is_hidden()
    page.goto('http://127.0.0.1:8001/experiments.html')
    page.locator('.experiment-cards a.experiment-open[href="repairs.html"]').click()
    page.wait_for_selector('#repair-content:visible')
    assert not errors, errors
    browser.close()
    print('PASS E9: presets, delay stress, zero fleet/participation, export, mobile, navigation, unavailable data')
