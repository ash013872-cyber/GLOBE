# GLOBE — Internet Speed Test

A mobile-first browser internet speed checker focused on real measurements rather than simulated numbers.

## Included

- Download measurement using streamed public test data
- Upload measurement using a real POST transfer
- Five-sample latency measurement
- Jitter estimate from latency samples
- Connection information from the browser Network Information API when available
- Live speed gauge and progress feedback
- Responsive UI for phone and desktop
- Clear failure state when a test endpoint cannot be reached

## Run locally

Because the app is static, serve the repository with any static web server. Opening `index.html` directly may restrict some browser networking features.

Example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Important measurement note

Browser-based speed tests are affected by the selected public endpoints, CORS policies, browser throttling, Wi‑Fi conditions, VPNs, background traffic and ISP routing. The app deliberately reports measured transfers rather than inventing a result. Running multiple times is recommended for comparison.
