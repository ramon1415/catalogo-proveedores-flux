import { createServer } from "node:http"
import { createReadStream, existsSync, mkdirSync } from "node:fs"
import { extname, join, normalize, relative, resolve } from "node:path"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const { chromium } = require("playwright")

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const outputDir = join(tmpdir(), "flux-approval-layout-visual")
mkdirSync(outputDir, { recursive: true })

const screens = [
  { name: "mobile-390x844", width: 390, height: 844 },
  { name: "mobile-412x915", width: 412, height: 915 },
  { name: "tablet-768x1024", width: 768, height: 1024 },
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "desktop-1920x1080", width: 1920, height: 1080 },
]
const zoomLevels = [1, 1.5, 2]
const themes = ["dark", "light"]

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
}

function serveFile(request, response) {
  const requestUrl = new URL(request.url || "/", "http://127.0.0.1")
  const requestedPath = normalize(decodeURIComponent(requestUrl.pathname).replace(/^\/+/, ""))
  const absolutePath = resolve(repoRoot, requestedPath || "index.html")
  const escaped = relative(repoRoot, absolutePath).startsWith("..")
  if (escaped || !existsSync(absolutePath)) {
    response.writeHead(404).end("Not found")
    return
  }
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": mimeTypes[extname(absolutePath)] || "application/octet-stream",
  })
  createReadStream(absolutePath).pipe(response)
}

function listen(server) {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen)
    server.listen(0, "127.0.0.1", () => resolveListen(server.address()))
  })
}

function close(server) {
  return new Promise((resolveClose) => server.close(resolveClose))
}

const server = createServer(serveFile)
const address = await listen(server)
const baseUrl = `http://127.0.0.1:${address.port}`
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
})
const page = await context.newPage()
const results = []
let axeCritical = 0
let axeSerious = 0

try {
  await page.goto(
    `${baseUrl}/scripts/qa/approval-execution-layout-visual-harness.html`,
    { waitUntil: "networkidle" }
  )
  await page.waitForFunction(() => Boolean(window.__approvalLayoutQa), null, {
    timeout: 15000,
  })
  await page.evaluate(() => {
    const qaTools = document.querySelector(".qa-dialog-tools")
    if (qaTools) qaTools.style.setProperty("display", "none", "important")
  })

  for (const screen of screens) {
    for (const zoom of zoomLevels) {
      const viewport = {
        width: Math.max(1, Math.floor(screen.width / zoom)),
        height: Math.max(1, Math.floor(screen.height / zoom)),
      }
      for (const theme of themes) {
        const name = `${screen.name}-zoom-${Math.round(zoom * 100)}-${theme}`
        const errors = []

        try {
          await page.setViewportSize(viewport)
          await page.evaluate((nextTheme) => {
            document.documentElement.dataset.theme = nextTheme
          }, theme)

          for (const kind of ["new-layout", "completion"]) {
            const selector = kind === "completion"
              ? "#layoutCompletionDialog"
              : "#newLayoutDialog"
            await page.evaluate((nextKind) => window.__approvalLayoutQa.open(nextKind), kind)
            const measurement = await page.evaluate((dialogSelector) => {
              const dialog = document.querySelector(dialogSelector)
              const form = dialog?.querySelector(".modal-content")
              const header = dialog?.querySelector(".modal-header")
              const scroller = dialog?.querySelector(".modal-scroll")
              const footer = dialog?.querySelector(".modal-actions")
              const viewportWidth = document.documentElement.clientWidth
              const viewportHeight = document.documentElement.clientHeight
              const rect = dialog?.getBoundingClientRect()
              const formRect = form?.getBoundingClientRect()
              const headerRect = header?.getBoundingClientRect()
              const scrollRect = scroller?.getBoundingClientRect()
              const footerRect = footer?.getBoundingClientRect()
              const visibleButtons = Array.from(
                dialog?.querySelectorAll("button:not([hidden])") || []
              ).filter((button) => {
                const style = getComputedStyle(button)
                const buttonRect = button.getBoundingClientRect()
                return style.display !== "none" &&
                  style.visibility !== "hidden" &&
                  buttonRect.width > 0 &&
                  buttonRect.height > 0
              })
              const buttonOverflow = visibleButtons
                .map((button) => ({
                  id: button.id || button.textContent.trim(),
                  rect: button.getBoundingClientRect(),
                }))
                .filter(({ rect: buttonRect }) =>
                  buttonRect.left < -1 ||
                  buttonRect.right > viewportWidth + 1 ||
                  buttonRect.left < rect.left - 1 ||
                  buttonRect.right > rect.right + 1
                )
                .map(({ id }) => id)

              return {
                viewportWidth,
                viewportHeight,
                documentOverflow:
                  document.documentElement.scrollWidth - viewportWidth,
                bodyOverflow: document.body.scrollWidth - viewportWidth,
                dialogOverflow: dialog.scrollWidth - dialog.clientWidth,
                formOverflow: form.scrollWidth - form.clientWidth,
                scrollerOverflow: scroller.scrollWidth - scroller.clientWidth,
                dialogOutside:
                  rect.left < -1 ||
                  rect.right > viewportWidth + 1 ||
                  rect.top < -1 ||
                  rect.bottom > viewportHeight + 1,
                formOutside:
                  formRect.left < rect.left - 1 ||
                  formRect.right > rect.right + 1 ||
                  formRect.top < rect.top - 1 ||
                  formRect.bottom > rect.bottom + 1,
                headerOverlap:
                  headerRect.bottom > scrollRect.top + 1,
                footerOverlap:
                  scrollRect.bottom > footerRect.top + 1,
                footerOutside:
                  footerRect.left < rect.left - 1 ||
                  footerRect.right > rect.right + 1 ||
                  footerRect.bottom > rect.bottom + 1
                    ? {
                      dialog: {
                        left: rect.left,
                        right: rect.right,
                        bottom: rect.bottom,
                      },
                      footer: {
                        left: footerRect.left,
                        right: footerRect.right,
                        top: footerRect.top,
                        bottom: footerRect.bottom,
                      },
                      form: {
                        top: formRect.top,
                        bottom: formRect.bottom,
                        height: formRect.height,
                      },
                      header: {
                        top: headerRect.top,
                        bottom: headerRect.bottom,
                        height: headerRect.height,
                      },
                      scroller: {
                        top: scrollRect.top,
                        bottom: scrollRect.bottom,
                        height: scrollRect.height,
                      },
                    }
                    : null,
                buttonOverflow,
              }
            }, selector)

            for (const [metric, value] of Object.entries(measurement)) {
              if (["viewportWidth", "viewportHeight"].includes(metric)) continue
              const failed = Array.isArray(value) ? value.length > 0
                : typeof value === "number" ? value > 1
                  : Boolean(value)
              if (failed) errors.push(`${kind}:${metric}=${JSON.stringify(value)}`)
            }

            const axe = await page.evaluate(async (dialogSelector) => {
              if (!window.axe) return { unavailable: true, critical: 1, serious: 1 }
              const report = await window.axe.run(
                document.querySelector(dialogSelector)
              )
              return {
                unavailable: false,
                criticalIds: report.violations
                  .filter((item) => item.impact === "critical")
                  .map((item) => item.id),
                seriousIds: report.violations
                  .filter((item) => item.impact === "serious")
                  .map((item) => `${item.id}:${item.nodes.map((node) => node.target.join(" ")).join("|")}`),
              }
            }, selector)
            axe.critical = axe.criticalIds?.length || axe.critical || 0
            axe.serious = axe.seriousIds?.length || axe.serious || 0
            axeCritical += axe.critical
            axeSerious += axe.serious
            if (axe.unavailable) errors.push(`${kind}:axe_unavailable`)
            if (axe.critical) errors.push(`${kind}:axe_critical=${axe.criticalIds.join(",")}`)
            if (axe.serious) errors.push(`${kind}:axe_serious=${axe.seriousIds.join(",")}`)
          }
        } catch (error) {
          errors.push(String(error?.stack || error))
        }

        if (errors.length) {
          await page.screenshot({
            path: join(outputDir, `${name}.png`),
            fullPage: true,
          })
        }
        results.push({
          name,
          physical: `${screen.width}x${screen.height}`,
          cssViewport: `${viewport.width}x${viewport.height}`,
          zoom: `${Math.round(zoom * 100)}%`,
          theme,
          pass: errors.length === 0,
          errors,
        })
      }
    }
  }
} finally {
  await context.close()
  await browser.close()
  await close(server)
}

const passed = results.filter((result) => result.pass).length
const summary = {
  matrix: `${passed}/${results.length}`,
  axe: {
    critical: axeCritical,
    serious: axeSerious,
  },
  outputDir,
  failures: results.filter((result) => !result.pass),
}
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
if (passed !== results.length || axeCritical !== 0 || axeSerious !== 0) {
  process.exitCode = 1
}
