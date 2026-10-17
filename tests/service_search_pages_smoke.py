"""Check the E12 public decision flow, failure state, export and mobile layout."""
import json
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://127.0.0.1:8001/service-search.html')
    page.wait_for_selector('#search-content:visible')
    assert '4／12' in page.locator('#search-verdict').inner_text()
    assert '59人' in page.locator('#search-validation-verdict').inner_text()
    assert '營運費差約0元' in page.locator('#search-cost').inner_text()
    assert page.locator('#search-grid td').count() == 20
    assert page.locator('#search-grid td.selected').count() == 1
    assert page.locator('#search-overview tbody tr').count() == 9
    for width in (390, 1440):
        page.set_viewport_size({'width': width, 'height': 1000})
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
        assert page.locator('.intro p').evaluate('(e)=>parseFloat(getComputedStyle(e).fontSize)') >= 20
        page.locator('#result').scroll_into_view_if_needed()
        page.screenshot(path=f'/tmp/service-search-results-{width}.png')
        page.locator('#validation').scroll_into_view_if_needed()
        page.screenshot(path=f'/tmp/service-search-validation-{width}.png')
    page.locator('#search-target').select_option('0.8')
    assert '沒有通過' in page.locator('#search-verdict').inner_text()
    assert '沒有選中的方案' in page.locator('#search-validation').inner_text()
    assert page.locator('#search-grid td.selected').count() == 0
    page.locator('#search-people').select_option('480')
    page.locator('#search-headway').select_option('6')
    assert '10／12' in page.locator('#search-verdict').inner_text()
    assert '6輛' in page.locator('#search-verdict').inner_text()
    with page.expect_download() as download:
        page.locator('#search-download').click()
    data = json.loads(open(download.value.path()).read())
    assert data['group']['condition'] == {'railPeople': 480, 'trainHeadway': 6}
    assert data['target'] == 0.8
    assert len(data['group']['trials']) == 20
    assert set(data['trainingSeeds']).isdisjoint(data['validationSeeds'])
    assert len(data['source_sha256']) == 4
    bad = browser.new_page()
    bad.route('**/service-search-results.json', lambda r: r.fulfill(status=503, body='unavailable'))
    bad.goto('http://127.0.0.1:8001/service-search.html')
    bad.wait_for_selector('#search-error:visible')
    assert bad.locator('#search-content').is_hidden()
    page.goto('http://127.0.0.1:8001/experiments.html')
    page.locator('.experiment-open[href="service-search.html"]').click()
    page.wait_for_selector('#search-content:visible')
    assert not errors, errors
    browser.close()
    print('PASS E12 candidate selection, holdout, no-candidate state, export, mobile, missing data and navigation')
