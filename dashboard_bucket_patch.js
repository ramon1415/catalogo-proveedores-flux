;(function installAnnualBudgetBucketPatch() {
  "use strict"

  const page = (window.location.pathname.split("/").pop() || "").toLowerCase()
  const annual = page === "dashboard.html" && new URLSearchParams(window.location.search).get("view") === "anual"
  if (!annual) return

  async function install() {
    // dashboard.js is parsed later than nav_first_paint_bootstrap.js. At DOMContentLoaded
    // its global functions and lexical state already exist, so this patch replaces only
    // the CONTPAQ→budget aggregation bridge while leaving the rest of the dashboard intact.
    if (typeof loadHistMapeo !== "function") return

    window.loadHistMapeo = async function loadHistMapeoByDerivedBucket() {
      state.histMapeo = new Map()
      state.histBucketMeta = new Map()
      try {
        const companyResult = await supabaseClient
          .from("historical_actuals")
          .select("company_id")
          .not("company_id", "is", null)
          .limit(1)
        if (companyResult.error) return
        const companyId = companyResult.data?.[0]?.company_id
        if (!companyId) return

        const { data: buckets, error } = await supabaseClient.rpc("contpaq_budget_bucket_members", {
          p_company_id: companyId,
        })
        if (error) return

        ;(buckets || []).forEach((bucket) => {
          const destination = {
            partida: bucket.bucket_label || "Control combinado",
            grupo: bucket.bucket_group || "Control combinado",
            bucketKey: bucket.bucket_key,
            categoryCount: Number(bucket.category_count || 0),
            accountCount: Number(bucket.account_count || 0),
            categoryNames: bucket.category_names || [],
            categoryCodes: bucket.category_codes || [],
            accountCodes: bucket.account_codes || [],
            activeBudgetTotal: Number(bucket.active_budget_total || 0),
          }
          state.histBucketMeta.set(bucket.bucket_key, destination)
          ;(bucket.account_codes || []).forEach((code) => {
            state.histMapeo.set(String(code).replace(/-/g, ""), destination)
          })
        })
      } catch (_) {
        state.histMapeo = new Map()
        state.histBucketMeta = new Map()
      }
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true })
  else window.setTimeout(install, 0)
})()
