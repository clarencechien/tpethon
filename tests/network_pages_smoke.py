"""Road direction, adverse outcomes, deep-linked methods, and mobile navigation."""
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8001/network.html')
 page.wait_for_function("document.querySelector('#network-verdict').textContent.includes('80 分鐘')")
 page.locator('#network-mode').select_option('closed')
 assert '65 分鐘' in page.locator('#network-verdict').inner_text()
 assert '少 15 分鐘' in page.locator('#network-verdict').inner_text()
 assert '4,000 輛' in page.locator('#network-conservation').inner_text()
 page.locator('[data-demand="1000"]').click()
 assert '多 30 分鐘' in page.locator('#network-verdict').inner_text()
 page.locator('#network-mode').select_option('reverse')
 assert page.locator('#connector-label').text_content()=='B → A'
 page.locator('#network-demand').focus();page.keyboard.press('End')
 assert '10,000 輛' in page.locator('#network-count').inner_text()
 assert '少 5 分鐘' in page.locator('#network-verdict').inner_text()
 page.set_viewport_size({'width':390,'height':844})
 assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
 page.screenshot(path='/tmp/neihu-network-mobile.png',full_page=True)
 page.goto('http://127.0.0.1:8001/methods.html#braess')
 assert '全文未取得' in page.locator('#braess').inner_text()
 assert page.locator('#braess a').get_attribute('href')=='https://doi.org/10.1287/trsc.1050.0127'
 assert '待執行計畫' in page.locator('#next').inner_text()
 assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
 page.goto('http://127.0.0.1:8001/brt.html#brt-research-details')
 assert page.locator('#brt-research-details').get_attribute('open') is not None
 assert page.locator('#research-cases').is_visible()
 assert not errors,errors
 print('PASS: road closure and reversal, improvement and harm, conserved demand, keyboard, mobile, source status, research deep links.')
 b.close()
