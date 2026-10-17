"""E10 public reading flow, map, worker, paired harm and hypothetical extra space."""
import json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:8001/corridor-trial.html')
    page.wait_for_selector('#trial-content:visible')
    assert page.locator('#trial-table tbody tr').count()==5
    assert page.locator('#trial-map .leaflet-overlay-pane path').count()>=8
    assert '仍開車者新增晚到 174 人' in page.locator('#trial-verdict').inner_text()
    assert '60／162' in page.locator('#trial-stress').inner_text()
    for width in (390,1440):
        page.set_viewport_size({'width':width,'height':1000})
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
        assert page.locator('.intro p').evaluate('(e)=>parseFloat(getComputedStyle(e).fontSize)')>=20
        page.locator('#route').scroll_into_view_if_needed()
        page.screenshot(path=f'/tmp/corridor-trial-map-{width}.png')
        page.locator('#comparison').scroll_into_view_if_needed()
        page.screenshot(path=f'/tmp/corridor-trial-results-{width}.png')
    page.locator('[data-trial-preset="extraSpace"]').click()
    page.wait_for_function("!document.getElementById('trial-run').disabled")
    assert '291 人轉乘' in page.locator('#trial-verdict').inner_text()
    assert '本次通過' in page.locator('#trial-verdict').inner_text()
    page.locator('[name="additionalLane"]').select_option('0')
    page.locator('#trial-run').click()
    page.wait_for_function("!document.getElementById('trial-run').disabled")
    assert '本次未通過' in page.locator('#trial-verdict').inner_text()
    assert '291 人轉乘' in page.locator('#trial-verdict').inner_text()
    page.locator('[data-trial-preset="extraSpaceDelayed"]').click()
    page.wait_for_function("!document.getElementById('trial-run').disabled")
    assert '291 人轉乘' in page.locator('#trial-verdict').inner_text()
    with page.expect_download() as dl:page.locator('#trial-download').click()
    payload=json.loads(open(dl.value.path()).read())
    assert payload['result']['options']['actualSpeedFactor']==.85
    assert len(payload['model_sha256'])==64
    assert next(r for r in payload['result']['results'] if r['id']=='brt')['screenPass']
    page.locator('#trial-form summary').click()
    page.locator('[name="participation"]').select_option('0')
    page.locator('#trial-run').click()
    page.wait_for_function("!document.getElementById('trial-run').disabled")
    assert '0 人轉乘' in page.locator('#trial-verdict').inner_text()
    assert '本次未通過' in page.locator('#trial-verdict').inner_text()
    assert 'NaN' not in page.locator('#trial-content').inner_text()
    bad=browser.new_page()
    bad.route('**/corridor-trial-inputs.json',lambda r:r.fulfill(status=503,body='unavailable'))
    bad.goto('http://127.0.0.1:8001/corridor-trial.html')
    bad.wait_for_selector('#trial-error:visible')
    assert bad.locator('#trial-content').is_hidden()
    page.goto('http://127.0.0.1:8001/experiments.html')
    page.locator('.experiment-cards a.experiment-open[href="corridor-trial.html"]').click()
    page.wait_for_selector('#trial-content:visible')
    assert not errors,errors
    browser.close()
    print('PASS E10 map, fixed-condition lane comparison, delay preset, export, zero participation, mobile, errors and navigation')
