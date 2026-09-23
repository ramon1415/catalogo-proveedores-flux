"""Browser UAT for FLUX CONTPAQ F-11705.
Runs the real ExportarSection from DEV source. All Supabase calls are intercepted
in-memory; the fixture itself is read-only data extracted from Supabase DEV.
"""
from pathlib import Path
from urllib.parse import urlparse
import json
from playwright.sync_api import sync_playwright, expect

ORIGIN = "http://127.0.0.1:4173"
OUT = Path("qa-artifact/contpaq-f11705-ui")
OUT.mkdir(parents=True, exist_ok=True)
fixture = json.loads(Path("app/public/qa-contpaq-fixture.json").read_text())
ledger_posts = []
unexpected = []

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1500, "height": 1000}, accept_downloads=True)
    context.set_default_timeout(12000)

    def route(r):
        req = r.request
        u = urlparse(req.url)
        if u.hostname == "flux-contpaq-ui-qa.invalid":
            if req.method == "OPTIONS":
                r.fulfill(status=200, content_type="application/json", body="{}",
                          headers={"Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Headers": "*"})
                return
            data = []
            status = 200
            if u.path == "/rest/v1/payment_requests" and req.method == "GET":
                data = [fixture["row"]]
            elif u.path == "/rest/v1/accounting_exports" and req.method == "GET":
                data = []
            elif u.path == "/rest/v1/accounting_exports" and req.method == "POST":
                payload = req.post_data_json
                ledger_posts.append(payload)
                data = []
                status = 201
            elif u.path == "/rest/v1/provider_account_mappings" and req.method == "GET":
                data = [{
                    "proveedor_id": fixture["row"]["proveedor_id"],
                    "contpaq_account_code": fixture["mappings"]["provider"],
                    "contpaq_provider_id": fixture["mappings"]["providerTerceroId"],
                }]
            elif u.path == "/rest/v1/partida_predictions" and req.method == "GET":
                data = []
            else:
                unexpected.append(f"{req.method} {req.url}")
                data = {"code": "QA_UNMOCKED", "message": "Unmocked QA request"}
                status = 500
            r.fulfill(
                status=status,
                content_type="application/json",
                body=json.dumps(data),
                headers={"Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Headers": "*"},
            )
            return
        if req.url.startswith(ORIGIN + "/"):
            r.continue_()
            return
        if u.hostname in ("fonts.googleapis.com", "fonts.gstatic.com"):
            r.fulfill(status=200, content_type="text/css", body="")
            return
        unexpected.append(f"{req.method} {req.url}")
        r.abort()

    context.route("**/*", route)
    page = context.new_page()
    dialogs = []
    page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))

    page.goto(ORIGIN + "/qa-contpaq-export.html", wait_until="networkidle")
    expect(page.get_by_role("heading", name="Exportar pólizas a CONTPAQ")).to_be_visible()

    page.get_by_label("Modo de póliza").select_option("dos-polizas")
    page.get_by_label("Mes (periodo contable)").fill("2026-08")
    page.get_by_role("button", name="Previsualizar", exact=True).click()

    expect(page.get_by_text("2 pólizas listas", exact=False)).to_be_visible()
    expect(page.get_by_text("$92,986.76", exact=False)).to_be_visible()
    expect(page.get_by_role("button", name="Exportar pólizas de diario (1)", exact=True)).to_be_enabled()
    expect(page.get_by_role("button", name="Exportar pólizas de pago (1)", exact=True)).to_be_enabled()
    page.screenshot(path=str(OUT / "01-preview-f11705.png"), full_page=True)

    with page.expect_download() as dl1:
        page.get_by_role("button", name="Exportar pólizas de diario (1)", exact=True).click()
    diario = dl1.value
    diario_path = OUT / diario.suggested_filename
    diario.save_as(str(diario_path))
    page.wait_for_timeout(300)
    assert len(ledger_posts) == 1, f"ledger insert expected once after diario, got {len(ledger_posts)}"
    posted = ledger_posts[0]
    assert isinstance(posted, list) and len(posted) == 2, posted
    assert [x.get("source_kind") for x in posted] == ["provision", "pago"], posted
    assert [x.get("tipo_pol") for x in posted] == [3, 2], posted

    with page.expect_download() as dl2:
        page.get_by_role("button", name="Exportar pólizas de pago (1)", exact=True).click()
    pago = dl2.value
    pago_path = OUT / pago.suggested_filename
    pago.save_as(str(pago_path))
    page.wait_for_timeout(300)
    assert len(ledger_posts) == 1, f"ledger must not be inserted twice, got {len(ledger_posts)}"

    assert diario_path.name.endswith("_diario.xls"), diario_path.name
    assert pago_path.name.endswith("_pago.xls"), pago_path.name
    assert not unexpected, unexpected

    evidence = {
        "diario": str(diario_path),
        "pago": str(pago_path),
        "ledger_posts": ledger_posts,
        "dialogs": dialogs,
        "unexpected": unexpected,
    }
    (OUT / "browser-evidence.json").write_text(json.dumps(evidence, indent=2))
    page.screenshot(path=str(OUT / "02-after-both-downloads.png"), full_page=True)
    browser.close()

print("CONTPAQ_F11705_UI_BROWSER_PASS")
