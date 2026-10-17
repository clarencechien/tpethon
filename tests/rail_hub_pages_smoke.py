"""E11 keeps observed road evidence distinct from synthetic rail-transfer outcomes."""
import json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:8001/rail-hub.html')
    page.wait_for_selector('#rail-content:visible')
    assert '94 筆有效' in page.locator('#rail-road-verdict').inner_text()
    assert '53 筆' in page.locator('#rail-road-verdict').inner_text()
    assert page.locator('#rail-heat tbody tr').count()==6
    assert page.locator('#rail-heat td').count()==66
    assert page.locator('#rail-services tbody tr').count()==4
    assert '內科通勤專車8' in page.locator('#rail-services').inner_text()
    assert page.locator('#rail-table tbody tr').count()==5
    assert '未確認鐵路新增名額' in page.locator('#rail-verdict').inner_text()
    assert '15／216' in page.locator('#rail-stress').inner_text()
    before=page.locator('#rail-heat').inner_text()
    page.locator('#rail-day').select_option('2026-10-05')
    assert page.locator('#rail-heat').inner_text()!=before
    for width in (390,1440):
        page.set_viewport_size({'width':width,'height':1000})
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
        assert page.locator('.intro p').evaluate('(e)=>parseFloat(getComputedStyle(e).fontSize)')>=20
        page.locator('#observed').scroll_into_view_if_needed()
        page.screenshot(path=f'/tmp/rail-hub-evidence-{width}.png')
        page.locator('#comparison').scroll_into_view_if_needed()
        page.screenshot(path=f'/tmp/rail-hub-results-{width}.png')
    page.locator('[data-rail-preset="quota"]').click()
    page.wait_for_function("!document.getElementById('rail-run').disabled")
    assert '接受 12 人' in page.locator('#rail-verdict').inner_text()
    page.locator('[data-rail-preset="delayed"]').click()
    page.wait_for_function("!document.getElementById('rail-run').disabled")
    assert '新增晚到 20 人' in page.locator('#rail-verdict').inner_text()
    with page.expect_download() as dl:page.locator('#rail-download').click()
    payload=json.loads(open(dl.value.path()).read())
    assert payload['result']['options']['trainDelay']==5
    assert len(payload['model_sha256'])==64
    assert next(r for r in payload['result']['results'] if r['id']=='priority')['converted']==44
    page.locator('[name="baseFleet"]').select_option('0')
    page.locator('[name="extraFleet"]').select_option('0')
    page.locator('#rail-run').click()
    page.wait_for_function("!document.getElementById('rail-run').disabled")
    assert '240人' in page.locator('#rail-table').inner_text()
    assert 'NaN' not in page.locator('#rail-content').inner_text()
    bad=browser.new_page()
    bad.route('**/rail-hub-inputs.json',lambda r:r.fulfill(status=503,body='unavailable'))
    bad.goto('http://127.0.0.1:8001/rail-hub.html')
    bad.wait_for_selector('#rail-error:visible')
    assert bad.locator('#rail-content').is_hidden()
    page.goto('http://127.0.0.1:8001/experiments.html')
    page.locator('.experiment-cards a.experiment-open[href="rail-hub.html"]').click()
    page.wait_for_selector('#rail-content:visible')
    assert not errors,errors
    browser.close()
    print('PASS E11 official evidence, date heatmap, service list, quota/delay worker, export, zero fleet, mobile, unavailable data and navigation')
