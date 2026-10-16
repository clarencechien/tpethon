"""BRT choices, provenance, invalid layouts and export in a real browser."""
import json
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:8001/brt.html')
    page.wait_for_function("document.querySelectorAll('#comparison tr').length===4")
    page.wait_for_function("document.querySelectorAll('#profile option').length>1")
    assert page.locator('#scan > div').count()==11
    assert '32 輛' in page.locator('#capacity').inner_text()
    page.locator('#shape').select_option('observed')
    page.wait_for_function("document.querySelector('#source').textContent.includes('套用')")
    page.locator('#period').select_option('pm')
    page.wait_for_function("!document.querySelector('#results').hidden")
    page.locator('#replay').fill('180');assert page.locator('#clock').inner_text()=='19:00'
    page.locator('#b-year').fill('2')
    page.wait_for_function("document.querySelector('#milestone').textContent.includes('第 2 年')")
    with page.expect_download() as event:page.locator('#download').click()
    with open(event.value.path()) as f:report=json.load(f)
    assert report['profile']['start_minute']==1020 and report['profile']['descriptor']['sha256']
    assert report['scenarios'][3]['privatePeople']==10404
    assert len(report['annual'])==5 and len(report['scan']['rows'])==11
    page.locator('#b-fleet').fill('0')
    page.wait_for_function("document.querySelector('#verdict').textContent.includes('尚未清空')")
    assert '等車輛返回' in page.locator('#capacity').inner_text()
    page.locator('#b-fleet').fill('40');page.get_by_text('車道、站點、路口與營運細節',exact=True).click();page.locator('#b-lanes').fill('2')
    page.wait_for_function("document.querySelector('#verdict').textContent.includes('無法同時保留')")
    page.locator('#b-lanes').fill('3');page.locator('#b-people').fill('')
    page.wait_for_function("document.querySelector('#results').hidden")
    assert page.locator('#download').is_disabled()
    page.locator('#b-people').fill('10000')
    page.wait_for_function("!document.querySelector('#results').hidden")
    page.screenshot(path='/tmp/neihu-brt-desktop.png',full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
    page.screenshot(path='/tmp/neihu-brt-mobile.png',full_page=True)
    assert not errors,errors
    bad=browser.new_page();bad.route('**/data/weeks/profiles.json',lambda r:r.fulfill(status=200,body='{}'))
    bad.goto('http://127.0.0.1:8001/brt.html')
    bad.wait_for_function("document.querySelector('#source').textContent.includes('版本不一致')")
    bad.locator('#shape').select_option('observed')
    bad.wait_for_function("document.querySelector('#error').textContent.includes('版本不一致')")
    assert bad.locator('#results').is_hidden() and bad.locator('#download').is_disabled()
    print('PASS: BRT scenarios, observed AM/PM, growth, constrained fleet, impossible layout, export, invalid data, mobile.')
    browser.close()
