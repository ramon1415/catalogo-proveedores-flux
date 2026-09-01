# Provider Portal privacy notice — approval gate

Status:

- `RAMON_BUSINESS_CONTENT_APPROVED=true`
- `PRIVACY_CONTENT_COMPLETE=true`
- `LEGAL_COUNSEL_REVIEWED=false`
- `PROD_PUBLISHED=false`

Target URL: `https://flux.quantta.mx/aviso-privacidad-proveedores.html`

Candidate file: `aviso-privacidad-proveedores.html`

## Approved business content

- Responsible entity: `Flux Financiera, S.A. de C.V., SOFOM E.N.R.`
- Address: `Montes Urales 760, Col. Lomas de Chapultepec, Alcaldía Miguel Hidalgo, C.P. 11000, Ciudad de México, México.`
- Technology processor: `Quantta`, acting only under the Responsible Entity's instructions and applicable contractual controls.
- ARCO area: `Finanzas`
- ARCO email: `finanzas@soportef.com`
- Unconverted intake retention: `3 months from last activity or intake closure`
- Converted payment-file retention: `2 years`, without prejudice to longer applicable legal, tax, contractual or authority requirements.
- Technical and security log retention: `10 months`
- Financial/patrimonial consent wording: approved by Ramón.
- Version: `1.0`
- Effective date: `18 August 2026`

All business placeholders are resolved. Ramón approved the supplied business content. No independent legal-counsel review has been evidenced; this document must not represent `LEGAL_COUNSEL_REVIEWED=true` without that evidence.

The page intentionally retains `noindex,nofollow` until release authorization. It contains no visible draft banner and is otherwise ready for publication review.

## Product contract that must accompany publication

The public Provider Intake form must present an unchecked, required checkbox before submit with this wording:

> Declaro que he leído el Aviso de Privacidad para Proveedores y otorgo mi consentimiento expreso para el tratamiento de los datos financieros y patrimoniales que proporcione, exclusivamente para las finalidades descritas en dicho Aviso.

Contract:

- `default=false`
- `required=true`
- separate from any secondary purpose
- visible link to the integral notice
- navigation, link opening and partial uploads do not constitute consent
- persist only the minimum acceptance evidence required by the current contract
- acceptance must be auditable and associated with the submitted intake
- the form must fail closed when the exact HTTPS privacy URL is missing or invalid

## Coverage map

| Required topic | Candidate section |
| --- | --- |
| Controller identity and address | 1 |
| Data subjects and scope | 2 |
| Personal-data categories, including financial/patrimonial | 3 |
| Necessary purposes | 4 |
| Express consent and revocation | 5 |
| Processors, transfers and recipients | 6 |
| ARCO, limitation and contact channel | 7 |
| Retention, blocking and deletion | 8 |
| Security and incidents | 9 |
| Automatic/technical collection | 10 |
| Notice changes and renewed consent | 11 |
| Competent authority | 12 |

## Publication and runtime gate

Expected publication target and runtime value:

```text
INTAKE_PRIVACY_NOTICE_URL=https://flux.quantta.mx/aviso-privacidad-proveedores.html
RAMON_BUSINESS_CONTENT_APPROVED=true
PRIVACY_CONTENT_COMPLETE=true
LEGAL_COUNSEL_REVIEWED=false
```

This change does not configure the runtime value. Publication, Vercel PROD changes, Edge deployment, PR #369 changes, mode activation, link creation, intake creation and PROD business-data writes remain unauthorized.
