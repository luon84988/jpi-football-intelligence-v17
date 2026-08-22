# Design QA — Bet365 欧亚盘内嵌表格

- Source visual truth: `C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-56bfd6bf-99e5-4eab-93b4-27911bb516ed.jpg`
- Source pixels: 1264 × 796
- Implementation: JPi 实时比赛矩阵，`app/page.js` + `app/market.css`
- Implementation screenshot: unavailable
- Intended viewport: desktop, ≥ 1250 CSS px, deviceScaleFactor 1
- State: Bet365 初始与即时欧赔、亚盘快照；无数据时显示待接入

## Full-view comparison evidence

Source image was opened at original resolution. It uses three semantic columns（公司、欧指、亚指）, two quote rows per bookmaker, loose horizontal spacing, light separators, and red/green movement coloring. The implementation follows that information structure inside the existing dark JPi matrix and intentionally retains the product theme.

Browser-rendered implementation evidence is unavailable in this Codex session, so full-view visual comparison cannot be completed.

## Focused-region comparison evidence

Source odds region was inspected at original resolution. The implementation maps each match to: Bet365 company cell; initial/current European 1X2 rows; initial/current Asian home-water/line/away-water rows; green decreases, red increases, neutral unchanged values.

Focused implementation capture is unavailable.

## Findings

- [P1] Rendered fidelity cannot be verified
  - Location: real-time match matrix.
  - Evidence: source image is available, but no browser-rendered implementation screenshot can be captured with the tools exposed to this session.
  - Impact: typography, track widths, wrapping, and responsive overflow cannot receive the required visual sign-off.
  - Fix: open the implementation in the in-app browser at desktop width, capture the matrix, and compare it side-by-side with the source.

## Required fidelity surfaces

- Fonts and typography: implemented with IBM Plex Mono/Consolas numeric fallbacks; browser comparison blocked.
- Spacing and layout rhythm: seven-column dense matrix implemented; browser comparison blocked.
- Colors and tokens: JPi dark tokens retained; source green/red movement semantics preserved.
- Image quality and assets: source contains no reusable raster/icon assets.
- Copy and content: 公司、欧指、亚指 and 初/即 semantics preserved.

## Comparison history

- Pass 1: source inspected; implementation built successfully; rendered capture unavailable, so no visual fixes can be evidence-validated.

## Implementation checklist

- Capture desktop implementation at ≥1250 CSS px.
- Compare full matrix and one focused Bet365 row against the reference.
- Correct any P0/P1/P2 typography, spacing, wrapping, or color differences.

final result: blocked
