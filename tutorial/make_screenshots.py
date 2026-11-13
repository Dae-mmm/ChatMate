# Rigenera gli screenshot della guida: serve il server simulato di test su localhost:3999 e Playwright con Chrome.
# Screenshot per il tutorial (interfaccia in inglese, server simulato)
from playwright.sync_api import sync_playwright
from PIL import Image
import io
B='http://localhost:3999'; OUT='/home/claude/chatmate/tutorial/'
def save(png, name, w=760):
    im = Image.open(io.BytesIO(png)).convert('RGB')
    if im.width > w: im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    im.save(OUT+name, 'JPEG', quality=82, optimize=True, progressive=True)
    print(name, im.size)
def union(pg, a, b, pad=16):
    x=pg.locator(a).first.bounding_box(); y=pg.locator(b).first.bounding_box()
    x0=min(x['x'],y['x'])-pad; y0=x['y']-pad*0.75; x1=max(x['x']+x['width'],y['x']+y['width'])+pad; y1=y['y']+y['height']+6
    return {'x':x0,'y':y0,'width':x1-x0,'height':y1-y0}
with sync_playwright() as p:
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome')
    ctx = br.new_context(viewport={'width':1280,'height':1000}, locale='en-US', device_scale_factor=2)
    pg = ctx.new_page()
    pg.goto(B+'/?p=login'); pg.evaluate("localStorage.setItem('chatmate:tutorial','done')")
    pg.click('#authTabs button[data-v=signup]')
    pg.fill('#authEmail','alex@example.com'); pg.fill('#authPass','segreta1'); pg.click('#authSubmit'); pg.wait_for_url('**/?p=account')
    pg.wait_for_selector('#keyStatus .badge'); pg.wait_for_timeout(300)
    pg.fill('#keyInput','sk-or-v1-8f3a2c')
    save(pg.screenshot(clip=union(pg, 'h3[data-i18n="acc.keyTitle"]', 'label:has(#reasoningOn)')), 'openrouter-key.jpg')
    pg.fill('#keyInput','sk-or-good-1234'); pg.click('#keySave'); pg.wait_for_timeout(700)
    pg.goto(B+'/'); pg.wait_for_selector('#lobbyModelPick select'); pg.wait_for_timeout(400)
    pg.fill('#name','Alex'); pg.select_option('#lobbyModelPick select','anthropic/claude-sonnet-5.5'); pg.wait_for_timeout(200)
    save(pg.screenshot(clip=union(pg, '.field:has(#opponent)', '#llmHint')), 'lobby.jpg')
    # copia e incolla
    pg.click('#llmOptions button[data-v=manual]')
    pg.click('#color button[data-v=b]'); pg.click('#create'); pg.wait_for_selector('#llmManual:not([hidden])', timeout=10000); pg.wait_for_timeout(500)
    save(pg.locator('#llmManual').screenshot(), 'copy-paste.jpg')
    pg.click('#llmApiCard summary'); pg.wait_for_timeout(200)
    pg.evaluate("document.getElementById('llmUrl').value = 'https://chatmate-chess.vercel.app/api/llm?game=3cuvc3bd&token=…'")
    save(pg.locator('#llmApiCard').screenshot(), 'direct-link.jpg')
    # ripasso con ragionamento
    pg.goto(B+'/'); pg.wait_for_selector('#lobbyModelPick select'); pg.wait_for_timeout(300)
    pg.click('#llmOptions button[data-v=auto]')
    pg.select_option('#lobbyModelPick select','anthropic/claude-sonnet-5.5'); pg.click('#color button[data-v=w]'); pg.click('#create'); pg.wait_for_selector('#board .sq')
    def mv(f,t,n): pg.wait_for_selector(f'[data-sq={f}].mine', timeout=15000); pg.click(f'[data-sq={f}]'); pg.click(f'[data-sq={t}]'); pg.wait_for_function(f"document.querySelectorAll('#moves span').length >= {n}", timeout=15000)
    mv('e2','e4',2); mv('g1','f3',4); mv('f1','c4',6); pg.wait_for_timeout(2500)
    pg.click('#moves span[data-ply="3"]'); pg.wait_for_timeout(400)
    pg.click('#reviewBody button[data-a=yes]'); pg.wait_for_timeout(300)
    save(pg.screenshot(), 'review.jpg', w=1100)
