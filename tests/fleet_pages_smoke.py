"""E4 fixed scenarios, model/map independence, mobile readability and unavailable inputs."""
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/*.tile.openstreetmap.org/**',lambda route:route.abort())
    page.goto('http://127.0.0.1:8001/fleet.html')
    page.wait_for_selector('#fleet-output:visible');page.wait_for_function("!document.querySelector('#route-choice').disabled")
    assert page.locator('.fleet-cell').count()==20
    assert '需要 44 輛' in page.locator('#fleet-verdict').inner_text()
    assert '17 / 22 天' in page.locator('#fleet-baseline').inner_text()
    page.locator('#fleet-arrival').select_option('0')
    assert '需要 38 輛' in page.locator('#fleet-verdict').inner_text()
    assert '22 / 22 天' in page.locator('#fleet-baseline').inner_text()
    page.locator('[data-share="0.2"][data-trip="50"]').click()
    assert '需要 55 輛' in page.locator('#fleet-verdict').inner_text()
    assert '0 / 22 天' in page.locator('#fleet-baseline').inner_text()
    assert page.locator('.fleet-cell[aria-pressed=true]').count()==1
    assert page.locator('#route-choice option').count()==14
    assert page.locator('#fleet-map .leaflet-interactive').count()>30
    page.locator('#route-choice').select_option('8')
    assert '沒有名稱直接對應' in page.locator('#route-summary').inner_text()
    assert '需要 55 輛' in page.locator('#fleet-verdict').inner_text()
    page.locator('#route-line').uncheck();page.locator('#route-fit').click();page.locator('#route-local').click()
    page.locator('#routes details').evaluate('(e)=>e.open=true')
    page.locator('#route-stops button').first.click()
    assert page.locator('.leaflet-popup').is_visible()
    assert page.locator('#tile-note').is_visible()
    for width in [390,1440]:
        page.set_viewport_size({'width':width,'height':1000})
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
        assert page.locator('#stress > p').first.evaluate('(e)=>parseFloat(getComputedStyle(e).fontSize)')>=20
        page.locator('#stress').scroll_into_view_if_needed();page.screenshot(path=f'/tmp/fleet-heat-{width}.png')
        page.locator('#routes').scroll_into_view_if_needed();page.screenshot(path=f'/tmp/fleet-route-{width}.png')
    for filename,visible,hidden in [('fleet-experiment.json','#route-choice','#fleet-output'),('route-candidates.json','#fleet-output',None)]:
        bad=browser.new_page();bad.route('**/'+filename,lambda r:r.fulfill(status=503,body='unavailable'))
        bad.goto('http://127.0.0.1:8001/fleet.html')
        bad.wait_for_selector('#fleet-error:visible' if hidden else '#route-error:visible')
        if hidden:
            bad.wait_for_function("!document.querySelector('#route-choice').disabled")
            assert bad.locator(hidden).is_hidden()
        else:bad.wait_for_selector(visible+':visible')
        bad.close()
    assert not errors,errors
    browser.close();print('PASS: fleet heatmap, burst mode, unchanged fleet on route selection, official stops, map fallback, input failure isolation, mobile readability')
