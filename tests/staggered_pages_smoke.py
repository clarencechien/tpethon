"""Question-first navigation, incremental observed profiles and no-gap substitution."""
from pathlib import Path
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://127.0.0.1:8001/experiments.html')
    assert page.locator('.qa-answer').count() == 12
    for card in page.locator('.experiment-cards article').all():
        assert '目前答案' in card.inner_text()
        assert '還不能說' in card.inner_text()
        assert card.locator('a.experiment-open').count() >= 1
    for a in page.locator('.experiment-open').all():
        href = a.get_attribute('href')
        assert (Path('_site') / href.split('#')[0]).exists(), href
    for width in (390, 1440):
        page.set_viewport_size({'width': width, 'height': 1000})
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
        page.locator('#qa-flex').scroll_into_view_if_needed()
        page.screenshot(path=f'/tmp/qa-{width}.png')
    page.locator('.experiment-open[href="staggered.html"]').click()
    page.wait_for_selector('#stagger-content:visible')
    assert '979' in page.locator('#stagger-metro-verdict').inner_text()
    assert '5.2%' in page.locator('#stagger-metro-verdict').inner_text()
    # Shared scale: policy peak must be visibly smaller than observed peak.
    bars = page.locator('#stagger-metro-chart .metric-fill')
    assert bars.nth(1).get_attribute('style') != bars.nth(4).get_attribute('style')
    page.locator('#stagger-share').select_option('0')
    assert '再移動0%' in page.locator('#stagger-metro-verdict').inner_text()
    page.locator('#stagger-day').select_option('2026-09-25')
    assert '2026-09-25' in page.locator('#stagger-metro-chart').inner_text()
    assert '沒有減少' in page.locator('#stagger-road-verdict').inner_text()
    page.locator('#stagger-capacity').select_option('900')
    assert '反而增加' in page.locator('#stagger-road-verdict').inner_text()
    page.locator('#stagger-policy').select_option('all_later')
    assert '沒有減少' in page.locator('#stagger-road-verdict').inner_text()
    page.locator('#stagger-road-day').select_option('2026-10-14')
    assert page.locator('#stagger-road-output').is_hidden()
    assert '沒有補零' in page.locator('#stagger-road-gap').inner_text()
    page.locator('#stagger-road-day').select_option('2026-10-15')
    page.locator('#stagger-policy').select_option('split10')
    for width in (390, 1440):
        page.set_viewport_size({'width': width, 'height': 1000})
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
        page.locator('#road').scroll_into_view_if_needed()
        page.screenshot(path=f'/tmp/staggered-road-{width}.png')
    bad = browser.new_page()
    bad.route('**/staggered-results.json', lambda r: r.fulfill(status=503, body='unavailable'))
    bad.goto('http://127.0.0.1:8001/staggered.html')
    bad.wait_for_selector('#stagger-error:visible')
    assert bad.locator('#stagger-content').is_hidden()
    assert not errors, errors
    browser.close()
    print('PASS Q&A links, incremental counts, shared scales, queue counterexamples, gaps, mobile and missing data')
