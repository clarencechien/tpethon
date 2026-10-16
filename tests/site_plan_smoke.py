from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/*.tile.openstreetmap.org/**',lambda r:r.abort())
    page.goto('http://127.0.0.1:8001/site-plan.html');page.wait_for_selector('#site-content:visible')
    assert '行善六場' in page.locator('#site-detail').inner_text()
    assert '53 格（全場總數，不是空位）' in page.locator('#site-detail').inner_text()
    assert '22 / 22 天' in page.locator('#site-operation-verdict').inner_text()
    assert '504' in page.locator('#site-operation-metrics').inner_text()
    assert page.locator('#site-stops article').count()==7
    assert page.locator('#site-gaps article').count()==3
    assert page.locator('#site-facilities tbody tr').count()==8
    assert page.locator('#site-map .leaflet-interactive').count()>=17
    shapes=page.locator('#site-map .leaflet-interactive').count()
    assert not page.locator('#site-car-routes').is_checked()
    page.locator('#site-car-routes').check()
    assert page.locator('#site-map .leaflet-interactive').count()==shapes+3
    assert '未限制站牌離站方向' in page.locator('#site-gaps').inner_text()
    page.locator('#site-car-routes').uncheck()
    assert page.locator('#site-map .leaflet-interactive').count()==shapes
    page.locator('#site-scenario').select_option('lean_detour')
    assert '0 / 22 天' in page.locator('#site-operation-verdict').inner_text()
    assert '120,000' in page.locator('#site-resources').inner_text()
    page.locator('#site-route').select_option('xihu')
    assert '西湖線' in page.locator('#site-operation-verdict').inner_text()
    page.locator('#site-scenario').select_option('pilot')
    assert '437' in page.locator('#site-operation-metrics').inner_text()
    assert '150,000' in page.locator('#site-resources').inner_text()
    page.locator('[data-facility="TPE1556"]').click()
    assert '9-17' in page.locator('#site-detail').inner_text()
    assert '晨尖峰' in page.locator('#site-detail').inner_text()
    page.locator('[data-facility="TPE0654"]').click()
    assert '0 格（全場總數，不是空位）' in page.locator('#site-detail').inner_text()
    assert '本輪不採用' in page.locator('#site-detail').inner_text()
    page.locator('[data-stop="0"]').click();assert '起站：上客' in page.locator('#site-detail').inner_text()
    assert page.locator('#site-tile-error').is_visible()
    page.locator('#site-all').click();page.locator('#site-fit').click()
    page.locator('#site-route').select_option('gangqian')
    for width in [390,1440]:
        page.set_viewport_size({'width':width,'height':1000})
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
        assert page.locator('.intro p').evaluate('(e)=>parseFloat(getComputedStyle(e).fontSize)')>=20
        page.locator('#site-fit').click()
        page.wait_for_function("()=>{const m=document.getElementById('site-map').getBoundingClientRect();const t=[...document.querySelectorAll('.site-pin')].find(e=>e.textContent.startsWith('起：'));const r=t.getBoundingClientRect();return r.left>=m.left&&r.right<=m.right;}")
        page.locator('#site-map').evaluate("e=>e.scrollIntoView({block:'start'})");page.screenshot(path=f'/tmp/site-map-{width}.png')
        page.locator('#site-operation-verdict').evaluate("e=>e.scrollIntoView({block:'start'})");page.screenshot(path=f'/tmp/site-operation-{width}.png')
    bad=browser.new_page();bad.route('**/site-service.json',lambda r:r.fulfill(status=503,body='unavailable'))
    bad.goto('http://127.0.0.1:8001/site-plan.html');bad.wait_for_selector('#site-error:visible')
    assert bad.locator('#site-content').is_hidden()
    assert not errors,errors
    browser.close();print('PASS: site plan, directional stops, separate facilities, unconfirmed capacity, fleet stress cases, source limitations, mobile layout, map and data failures')
