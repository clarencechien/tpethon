"""Run against python app.py; test CSV is restored/removed after validation."""
from pathlib import Path
from playwright.sync_api import sync_playwright

path=Path(__file__).resolve().parents[1]/'local-data'/'observations.json'
original=path.read_bytes() if path.exists() else None
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':1440,'height':1000})
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto('http://127.0.0.1:8000')
        page.wait_for_function("document.querySelector('#live-roads').children.length>0",timeout=45000)
        page.wait_for_function("document.querySelector('#metro-rows').children.length>0")
        assert page.locator('#metro-date option').count()>0
        assert page.locator('#metro-entries .bar-row').count()>0
        assert page.locator('#metro-destinations .bar-row').count()>0
        page.locator('#bus-filter').fill('西湖')
        assert page.locator('#live-buses tr').count()>0
        print('Live roads:',page.locator('#live-roads tr').count())
        print('Metro status:',page.locator('#metro-status').inner_text())
        page.locator('#metro-date').select_option(index=0)
        assert page.locator('#metro-rows tr').count()>0
        page.screenshot(path='/tmp/tpethon-desktop.png',full_page=True)
        page.set_viewport_size({'width':390,'height':844})
        assert not page.evaluate('document.documentElement.scrollWidth > window.innerWidth')
        page.screenshot(path='/tmp/tpethon-mobile.png',full_page=True)
        page.locator('summary').click()
        page.on('dialog',lambda d:d.accept())
        csv='mode,timestamp,location,metric,value,interval_minutes,source\nroad,2026-10-15T07:00:00+08:00,TEST-FIXTURE,vehicles,42,15,test-only\n'
        page.locator('#upload').set_input_files({'name':'test.csv','mimeType':'text/csv','buffer':csv.encode()})
        page.wait_for_function("document.querySelector('#message').textContent.includes('已匯入 1 筆')")
        assert page.locator('#cards .number').first.inner_text()=='42'
        page.locator('#location').fill('NOT-MATCHING')
        assert page.locator('#rows tr').count()==0
        assert not page.evaluate('document.documentElement.scrollWidth > window.innerWidth')
        assert not errors,errors
        print('PASS: live data, metro date/chart, bus filter, CSV import, history filter, mobile layout, no JS errors')
        browser.close()
finally:
    if original is None:
        path.unlink(missing_ok=True)
    else:
        path.write_bytes(original)
