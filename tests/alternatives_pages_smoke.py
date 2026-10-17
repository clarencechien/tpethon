"""Exercise the E8 comparison, worker, missing data and small screen layout."""
import json
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://127.0.0.1:8001/alternatives.html')
    page.wait_for_selector('#alternative-content:visible')
    assert page.locator('#alternative-table tbody tr').count() == 5
    assert '802' in page.locator('#alternative-verdict').inner_text()
    assert '1,360' in page.locator('#alternative-verdict').inner_text()
    assert '48組' in page.locator('#alternative-sensitivity').inner_text()
    assert '160' in page.locator('#alternative-budget').inner_text()
    page.locator('[data-result="express"]').click()
    assert page.locator('#alternative-detail').input_value() == 'express'
    assert page.locator('#alternative-lines tbody tr').count() == 8
    for width in (390, 1440):
        page.set_viewport_size({'width': width, 'height': 1000})
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
        assert page.locator('.intro p').evaluate('(e)=>parseFloat(getComputedStyle(e).fontSize)') >= 20
        page.locator('#comparison').scroll_into_view_if_needed()
        page.screenshot(path=f'/tmp/alternatives-{width}.png')
    page.locator('[name="parkingShare"]').select_option('0')
    page.locator('#alternative-run').click()
    page.wait_for_function("!document.getElementById('alternative-run').disabled")
    assert '從 1,200 變成 1,200' in page.locator('#alternative-verdict').inner_text()
    page.locator('#alternative-detail').select_option('park')
    assert '停車 0／0 格' in page.locator('#alternative-budget').inner_text()
    with page.expect_download() as download:
        page.locator('#alternative-download').click()
    payload = json.loads(open(download.value.path()).read())
    assert payload['result']['options']['parkingShare'] == 0
    assert payload['result']['results'][3]['carTrips'] == 1200
    page.locator('[name="carPeople"]').fill('0')
    page.locator('[name="transitPeople"]').fill('0')
    page.locator('#alternative-run').click()
    page.wait_for_function("!document.getElementById('alternative-run').disabled")
    assert 'NaN' not in page.locator('#alternative-content').inner_text()
    assert '— 分' in page.locator('#alternative-table').inner_text()
    bad = browser.new_page()
    bad.route('**/alternatives-results.json', lambda r: r.fulfill(status=503, body='unavailable'))
    bad.goto('http://127.0.0.1:8001/alternatives.html')
    bad.wait_for_selector('#alternative-error:visible')
    assert bad.locator('#alternative-content').is_hidden()
    page.goto('http://127.0.0.1:8001/experiments.html')
    page.locator('.experiment-cards a.experiment-open[href="alternatives.html"]').click()
    page.wait_for_selector('#alternative-content:visible')
    assert not errors, errors
    browser.close()
    print('PASS E8 comparison, cohort results, worker, export, empty cohort, mobile layout, navigation and missing data')
