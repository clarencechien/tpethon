from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('**/*.tile.openstreetmap.org/**',lambda r:r.abort())
 page.goto('http://127.0.0.1:8001/hubs.html');page.wait_for_selector('#hub-content:visible')
 assert page.locator('#hub-presets tbody tr').count()==6
 assert page.locator('#hub-parking tbody tr').count()==6
 assert '3,387' in page.locator('#hub-takeaway').inner_text()
 assert '4,837' in page.locator('#hub-metrics').inner_text()
 page.locator('[data-case="hov"]').click();assert '延後進區' in page.locator('#hub-verdict').inner_text()
 assert '增加' in page.locator('#hub-verdict').inner_text()
 page.locator('[name="hov"]').select_option('0');page.locator('[name="appShare"]').select_option('0')
 page.locator('#hub-run').click();page.wait_for_function("!document.getElementById('hub-run').disabled")
 assert '6,000 輛' in page.locator('#hub-metrics').inner_text()
 assert '補助支出\n0 元' in page.locator('#hub-metrics').inner_text()
 page.locator('[name="appShare"]').select_option('0.6')
 page.locator('[name="parkingShare"]').select_option('0');page.locator('[name="poolSubsidy"]').select_option('0')
 page.locator('#hub-run').click();page.wait_for_function("!document.getElementById('hub-run').disabled")
 assert '6,000 輛' in page.locator('#hub-metrics').inner_text()
 with page.expect_download() as d:page.locator('#hub-download').click()
 assert d.value.suggested_filename.endswith('.json')
 page.locator('[data-location="airport"]').click();assert '500 格' in page.locator('#hub-detail').inner_text()
 page.locator('#hub-regional').click();page.locator('#hub-fit').click()
 for width in [390,1440]:
  page.set_viewport_size({'width':width,'height':1000});page.locator('#hub-fit').click()
  assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
  page.locator('#hub-map').scroll_into_view_if_needed();page.screenshot(path=f'/tmp/hubs-map-{width}.png')
  page.locator('#hub-verdict').scroll_into_view_if_needed();page.screenshot(path=f'/tmp/hubs-result-{width}.png')
  assert page.locator('.intro p').evaluate('(e)=>parseFloat(getComputedStyle(e).fontSize)')>=20
 bad=b.new_page();bad.route('**/hub-inputs.json',lambda r:r.fulfill(status=503,body='unavailable'))
 bad.goto('http://127.0.0.1:8001/hubs.html');bad.wait_for_selector('#hub-error:visible');assert bad.locator('#hub-content').is_hidden()
 assert not errors,errors
 b.close();print('PASS: hub maps, scenarios, worker recomputation, zero participants and zero parking, exported results, mobile layout and data failure')
