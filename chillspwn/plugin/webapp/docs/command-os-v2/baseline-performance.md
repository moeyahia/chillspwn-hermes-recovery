# Baseline performance

Date: 2026-07-15

## Build measurements

Measured from a clean production build before Command OS V2.1 implementation:

| Metric | Baseline |
| --- | ---: |
| Vite modules transformed | 66 |
| Build time | 23.86 s |
| Output files | 37 |
| Total build output | 2,766,399 bytes |
| Initial shell JS | 214.08 kB raw / 67.26 kB gzip |
| Global CSS | 62.05 kB raw / 12.87 kB gzip |
| Default Chat chunk | 76.50 kB raw / 23.13 kB gzip |
| Effective initial shell + default chat | about 103.26 kB gzip |
| Terminal route chunk | 342.96 kB raw / 87.34 kB gzip |

Large static inputs include `Logo.svg` at 324,068 bytes, `smallLogo.png` at 131,127 bytes, and `Background.svg` at 1,224,058 bytes.

## Browser observation

A local reload of the deployed baseline reached `DOMContentLoaded` at approximately 1,016 ms and load at approximately 2,809 ms in the active test browser. This is an observational trace, not a controlled Lighthouse result. The page had 210 DOM elements after settling.

## Known boot-path costs

- `index.html` includes temporary telemetry timers.
- A forced splash keeps the application hidden for about 800 ms.
- Google Fonts are external render-path dependencies.
- Chat is the default route and therefore part of the normal first interaction.
- Multiple independent polling loops wake the client even when no meaningful state changes.

## Missing baseline evidence

No existing automated Lighthouse, Web Vitals, axe, visual regression, long-session memory, event throughput, 100,000-event list, or 50,000-node graph benchmark exists. FCP, LCP, INP, CLS, and accessibility conformance are not claimed until measured by the V2.1 suite.

## Budgets

V2.1 will enforce the product prompt's desktop/mobile Web Vitals, route chunk, event latency, graph, query, and hidden-tab budgets. Measurements will be appended here with environment, command, date, result, and documented exceptions.
