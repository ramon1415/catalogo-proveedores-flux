"""Full built FLUX UI; all identity/catalog/API operations are in-memory fixtures.
Run only against the CI bundle built with https://flux-qa.invalid.
No production credentials, live API requests, or database writes.
"""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from urllib.parse import urlparse, parse_qs
import base64
import json
import os
import subprocess
import time
import uuid
from playwright.sync_api import sync_playwright, expect

ROOT = Path('app/dist').resolve()
OUT = Path('qa-artifact/browser-full').resolve()
OUT.mkdir(parents=True, exist_ok=True)
COMPANY = '11111111-1111-4111-8111-111111111111'
USER = '22222222-2222-4222-8222-222222222222'
PROFILE = '33333333-3333-4333-8333-333333333333'
if not ROOT.joinpath('index.html').is_file():
    raise SystemExit('Full app build missing')
if not any('https://flux-qa.invalid' in f.read_text() for f in ROOT.glob('assets/*.js')):
    raise SystemExit('Refusing a bundle without the synthetic .invalid configuration')

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/api/runtime-config':
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript')
            self.end_headers()
            self.wfile.write(b'// QA: compiled Vite configuration is synthetic.\n')
            return
        if not (ROOT / path.lstrip('/')).is_file() and '.' not in path.rsplit('/', 1)[-1]:
            self.path = '/index.html'
        super().do_GET()

    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
Thread(target=server.serve_forever, daemon=True).start()
origin = f'http://127.0.0.1:{server.server_port}'
results = []
user = dict(id=USER, email='qa@example.invalid', aud='authenticated', role='authenticated',
            app_metadata={}, user_metadata={}, created_at='2026-01-01T00:00:00Z')
profile = dict(id=PROFILE, email=user['email'], full_name='Prueba automatizada FLUX', auth_user_id=USER, active=True)

def case(name, func):
    start = time.monotonic()
    try:
        func()
        results.append(dict(name=name, passed=True, seconds=round(time.monotonic()-start, 2)))
        print('PASS:', name, flush=True)
    except Exception as error:
        results.append(dict(name=name, passed=False, error=str(error), seconds=round(time.monotonic()-start, 2)))
        print('FAIL:', name, str(error), flush=True)
        raise

with sync_playwright() as pw:
    # Verify the new runner's local dev server with the native agent-browser CLI.
    # This is a different ephemeral CI environment; no local policy is modified.
    cli = os.environ.get('AGENT_BROWSER_BIN', 'agent-browser')
    cli_args = [cli, '--session', 'flux-bulk-ci', '--executable-path', pw.chromium.executable_path]
    def cli_call(*args):
        proc = subprocess.run(cli_args + list(args), text=True, capture_output=True, timeout=45)
        with OUT.joinpath('agent-browser.log').open('a') as log:
            log.write('COMMAND: ' + ' '.join(args) + '\n' + proc.stdout + proc.stderr + '\n')
        if proc.returncode:
            raise RuntimeError(proc.stderr or proc.stdout)
        return proc.stdout

    def agent_smoke():
        cli_call('open', origin + '/proveedores')
        cli_call('wait', '--load', 'networkidle')
        text = cli_call('snapshot', '-i')
        assert 'Continuar con Google' in text, text
        assert 'HAS_CONTENT' in cli_call('eval', "document.body.innerText.trim().length > 0 ? 'HAS_CONTENT' : 'BLANK'")
        assert 'NO_OVERLAY' in cli_call('eval', "document.querySelector('vite-error-overlay, [data-nextjs-dialog]') ? 'ERROR' : 'NO_OVERLAY'")
        cli_call('screenshot', str(OUT / '00-login-full-app.png'))
    try:
        case('agent-browser: full build opens login with no blank page or overlay', agent_smoke)
    finally:
        cli_call('close')

    browser = pw.chromium.launch(headless=True)
    context = browser.new_context(viewport=dict(width=1440, height=1000), service_workers='block')
    context.set_default_timeout(10000)
    api, unexpected, errors, console_errors, providers, writes = [], [], [], [], [], []
    scenario = dict(mode='normal', attempts=0, fired=False)

    def route(r):
        req = r.request
        u = urlparse(req.url)
        query = parse_qs(u.query)
        if u.hostname == 'flux-qa.invalid':
            api.append(dict(path=u.path, method=req.method))
            status, data = 200, []
            if req.method == 'OPTIONS':
                data = {}
            elif u.path == '/rest/v1/rpc/ensure_current_profile':
                data = profile
            elif u.path == '/rest/v1/rpc/get_my_payroll_access':
                data = dict(can_capture=False, can_pay=False)
            elif u.path == '/rest/v1/user_roles':
                data = [dict(role_id='qa-role', roles=dict(name='finanzas'))]
            elif u.path == '/rest/v1/profile_company_memberships':
                data = [dict(company_id=COMPANY, role_key='finanzas', active=True,
                             companies=dict(id=COMPANY, name='Operadora QA', legal_name='Operadora QA', active=True))]
            elif u.path == '/rest/v1/company_modules':
                data = [dict(module_key='proveedores', enabled=True, version=1)]
            elif u.path == '/auth/v1/user':
                data = user
            elif u.path == '/rest/v1/proveedores' and req.method == 'GET':
                data = sorted(providers, key=lambda x: x['id'])
                after = query.get('id', [''])[0]
                if after.startswith('gt.'):
                    data = [x for x in data if x['id'] > after[3:]]
                data = data[:int(query.get('limit', ['10000'])[0])]
            elif u.path == '/rest/v1/rpc/save_provider_catalog_with_payment_execution_data' and req.method == 'POST':
                payload = req.post_data_json
                assert payload['p_proveedor_id'] is None, 'Bulk must never update an existing provider'
                scenario['attempts'] += 1
                writes.append(payload)
                if scenario['mode'] == 'unique' and not scenario['fired']:
                    scenario['fired'] = True
                    data = dict(code='23505', message='Synthetic unique constraint violation')
                    status = 409
                else:
                    ident = str(uuid.uuid4())
                    providers.append(dict(id=ident, **payload['p_payload']))
                    if scenario['mode'] == 'lost' and not scenario['fired']:
                        scenario['fired'] = True
                        r.abort('failed')
                        return
                    data = dict(id=ident)
            else:
                unexpected.append(req.url)
                data, status = dict(code='QA_UNMOCKED', message='Unmocked request'), 500
            r.fulfill(status=status, content_type='application/json', body=json.dumps(data),
                      headers={'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': '*'})
            return
        if u.hostname in ('fonts.googleapis.com', 'fonts.gstatic.com'):
            r.fulfill(status=200, content_type='text/css', body='')
            return
        if req.url.startswith(origin + '/'):
            r.continue_()
            return
        unexpected.append(req.url)
        r.abort()

    context.route('**/*', route)
    encode = lambda o: base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip('=')
    token = encode(dict(alg='none', typ='JWT')) + '.' + encode(dict(sub=USER, aud='authenticated', exp=int(time.time())+7200)) + '.synthetic'
    session = dict(access_token=token, refresh_token='synthetic-not-a-credential', expires_in=7200,
                   expires_at=int(time.time())+7200, token_type='bearer', user=user)
    context.add_init_script('localStorage.setItem("sb-flux-qa-auth-token",' + json.dumps(json.dumps(session)) + ');'
                            'sessionStorage.setItem("flux.company",' + json.dumps(COMPANY) + ');')
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda msg: console_errors.append(msg.text) if msg.type == 'error' else None)

    def button(name):
        return page.get_by_role('button', name=name, exact=True)

    def open_bulk(text):
        button('Carga masiva').click()
        page.get_by_role('dialog').locator('textarea').fill(text)
        button('Verificar catálogo').click()
        expect(page.get_by_text('Catálogo verificado. Los existentes se omiten sin cambiar sus datos.', exact=True)).to_be_visible()

    def close_bulk():
        dialog = page.get_by_role('dialog')
        close = dialog.get_by_role('button', name='Cerrar y actualizar catálogo', exact=True)
        if close.count():
            close.click()
        else:
            dialog.get_by_role('button', name='Cerrar', exact=True).click()
        expect(page.get_by_role('dialog')).to_have_count(0)

    def shell():
        page.goto(origin + '/proveedores', wait_until='networkidle')
        expect(button('Carga masiva')).to_be_visible()
        expect(button('Nuevo proveedor')).to_be_visible()
        expect(page.get_by_role('region', name='Tabla de Proveedores')).to_be_visible()
        page.screenshot(path=str(OUT / '01-catalogo-desktop.png'))
    def create_csv():
        open_bulk('QA Inicial,"Proveedor, SA",ABC010101AA1,Efectivo,,')
        button('Crear 1 proveedores').click()
        expect(page.get_by_text('Creado.', exact=True)).to_be_visible()
        assert len(writes) == 1 and providers[0]['nombre_completo'] == 'Proveedor, SA'
        assert providers[0]['beneficiary_name'] is None
        page.screenshot(path=str(OUT / '02-creado-desktop.png'))
        close_bulk()
        expect(page.get_by_role('cell', name='QA Inicial', exact=True)).to_be_visible()
    def repeated():
        before = len(writes)
        providers[0]['activo'] = False
        open_bulk('QA Inicial,"Proveedor, SA",ABC010101AA1,Efectivo,,')
        expect(page.get_by_text('Ya existe por RFC (inactivo). No se creará, actualizará ni reactivará.', exact=True)).to_be_visible()
        expect(button('Crear 0 proveedores')).to_be_disabled()
        assert len(writes) == before and providers[0]['activo'] is False
        close_bulk()
    def partial():
        scenario.update(mode='unique', fired=False)
        before = len(writes)
        open_bulk('QA Error,Proveedor 2,DEF010101AA2,Efectivo,,\nQA Bien,Proveedor 3,GHI010101AA3,Efectivo,,')
        button('Crear 2 proveedores').click()
        expect(page.get_by_text('No creado', exact=True)).to_be_visible()
        expect(page.get_by_text('Creado.', exact=True)).to_be_visible()
        assert len(writes) == before + 2
        button('Corregir solo pendientes').click()
        assert 'QA Bien' not in page.get_by_role('dialog').locator('textarea').input_value()
        scenario.update(mode='normal', fired=False)
        button('Verificar catálogo').click()
        button('Crear 1 proveedores').click()
        expect(page.get_by_text('Creado.', exact=True)).to_be_visible()
        assert len(writes) == before + 3
        close_bulk()
    def lost():
        scenario.update(mode='lost', fired=False)
        before = len(writes)
        open_bulk('QA Perdido,Proveedor 4,JKL010101AA4,Efectivo,,\nQA Siguiente,Proveedor 5,MNO010101AA5,Efectivo,,')
        button('Crear 2 proveedores').click()
        expect(page.get_by_text('Por verificar', exact=True)).to_be_visible()
        expect(page.get_by_text('Pendiente', exact=True)).to_be_visible()
        assert len(writes) == before + 1
        scenario.update(mode='normal', fired=False)
        button('Reintentar 2 pendientes').click()
        expect(page.get_by_text('Ya existe', exact=True)).to_be_visible()
        expect(page.get_by_text('Creado.', exact=True)).to_be_visible()
        assert len(writes) == before + 2
        close_bulk()
    def individual():
        button('Nuevo proveedor').click()
        expect(page.get_by_role('dialog').get_by_role('heading', name='Nuevo proveedor', exact=True)).to_be_visible()
        page.get_by_role('dialog').get_by_role('button', name='Cancelar', exact=True).click()
        expect(page.get_by_role('dialog')).to_have_count(0)
    def responsive(width, theme):
        page.set_viewport_size(dict(width=width, height=900))
        page.evaluate('(theme) => document.documentElement.dataset.theme = theme', theme)
        button('Carga masiva').click()
        text = '\n'.join(f'QA Visual {n},Proveedor visual {n},,Efectivo,,' for n in range(35))
        page.get_by_role('dialog').locator('textarea').fill(text)
        region = page.get_by_role('region', name='Revisión por proveedor; tabla con desplazamiento interno')
        box = page.get_by_role('dialog').bounding_box()
        assert box and box['x'] >= -1 and box['x'] + box['width'] <= width + 1, box
        dimensions = region.evaluate('(el) => ({w:el.clientWidth, sw:el.scrollWidth, h:el.clientHeight, sh:el.scrollHeight})')
        assert dimensions['sh'] > dimensions['h'], dimensions
        if width <= 768:
            assert dimensions['sw'] > dimensions['w'], dimensions
        assert button('Cerrar alta masiva').bounding_box()['width'] >= 44
        page.screenshot(path=str(OUT / f'visual-{width}-{theme}.png'))
        close_bulk()
    def readonly():
        page.goto(origin + '/proveedores?mode=readonly', wait_until='networkidle')
        expect(page.get_by_role('region', name='Tabla de Proveedores')).to_be_visible()
        expect(button('Carga masiva')).to_have_count(0)
        expect(button('Nuevo proveedor')).to_have_count(0)
    try:
        case('Full authenticated router, providers page and current internal table', shell)
        case('Quoted CSV creates fixture and closing refreshes the shared catalog', create_csv)
        case('Repeated RFC in inactive catalog is omitted without update or reactivation', repeated)
        case('23505 fixture preserves partial results and retries only pending row', partial)
        case('Lost response stops and next explicit retry finds persisted fixture', lost)
        case('Individual capture still opens and cancels without writes', individual)
        for width in (320, 390, 768, 1440):
            for theme in ('light', 'dark'):
                case(f'Full app modal at {width}px {theme}: internal two-axis scroll', lambda w=width,t=theme: responsive(w,t))
        case('Readonly route offers neither bulk nor individual creation', readonly)
        assert not unexpected, unexpected
        assert not errors, errors
    except Exception:
        page.screenshot(path=str(OUT / 'failure.png'))
        OUT.joinpath('failure-body.txt').write_text(page.locator('body').inner_text())
        raise
    finally:
        report = dict(source_commit=os.environ.get('GITHUB_SHA', 'unknown'), scope='built full application with in-memory API fixtures; NOT live UAT or installed PWA',
                      results=results, passed=sum(x['passed'] for x in results), failed=sum(not x['passed'] for x in results),
                      api_requests=api, mock_attempts=len(writes), fixture_records=len(providers),
                      unexpected_requests=unexpected, page_errors=errors, console_errors=console_errors)
        OUT.joinpath('results.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(json.dumps(dict(passed=report['passed'],failed=report['failed'],unexpected=unexpected,page_errors=errors)), flush=True)
        context.close()
        browser.close()
        server.shutdown()
