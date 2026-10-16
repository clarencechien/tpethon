"""Static-site browser checks. Run the built site on port 8001 first."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:8001')
    page.wait_for_function("document.querySelector('#stat-valid').textContent.includes('/')")
    page.wait_for_function("document.querySelector('#metro-total').textContent !== '—'")
    assert page.locator('.vd-marker').count()>0
    page.locator('#corridor').select_option('堤頂')
    page.locator('#direction').select_option('N')
    assert page.locator('.vd-marker').count()>0
    assert page.locator('.vd-marker').count()<40
    page.locator('#search').fill('DOES-NOT-EXIST')
    assert page.locator('.vd-marker').count()==0
    assert page.locator('#stat-hot').inner_text()=='—'
    page.locator('#search').fill('');page.locator('#corridor').select_option('');page.locator('#direction').select_option('')
    page.locator('#show-bus').check()
    assert page.locator('.leaflet-overlay-pane path').count()>0
    page.locator('#show-bus').uncheck()
    page.locator('#metric').select_option('occupancy')
    assert '≥50%' in page.locator('#legend').inner_text()
    if int(page.locator('#time').get_attribute('max'))>0:
        page.locator('#time').fill('0');page.locator('#time').dispatch_event('input')
        assert page.locator('#freshness').inner_text()=='歷史快照回放'
    if page.locator('.rank').count():
        page.locator('.rank').first.click()
        assert 'Link' in page.locator('#detail').inner_text()
        assert page.locator('.leaflet-popup').count()==1
        page.locator('.leaflet-popup-close-button').click()
    page.locator('#latest').click();page.locator('#fit').click()
    page.screenshot(path='/tmp/neihu-map-desktop.png',full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    page.wait_for_timeout(300)
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
    page.screenshot(path='/tmp/neihu-map-mobile.png',full_page=True)
    assert not errors,errors
    print('PASS: OSM map controls, corridor/direction/search, layers, legend, historical replay, evidence detail, mobile width, no JS errors.')
    print('Tile browser status:', 'fallback warning visible' if page.locator('#tile-warning').is_visible() else f"{page.locator('.leaflet-tile-loaded').count()} tiles loaded")
    browser.close()
