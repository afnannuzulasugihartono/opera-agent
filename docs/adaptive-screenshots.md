# Adaptive screenshots

Opera Agent 1.4.0 introduces bounded visual observation for pages that semantic text and element references cannot describe reliably, including canvas and map interfaces.

## Capture contract

- `page.capture` targets one explicit HTTP/HTTPS `tabId` and uses CDP `Page.captureScreenshot` without activating the tab or focusing its window.
- The default capture covers the visible viewport and returns JPEG at quality 60, bounded to 1280×900.
- Optional crops use viewport-relative `x`, `y`, `width`, and `height` and must remain fully inside the viewport.
- Requested maximum dimensions cannot exceed 1600×1200. Encoded JPEG bytes cannot exceed 220 KiB; quality and scale are reduced locally before a structured failure is returned.
- Captures are transient. The extension retains at most eight images in memory for 750 ms frequency control and never writes screenshot bytes to browser storage. The dedicated Supabase await function returns each completed image once and atomically replaces the database payload with non-image audit metadata; a timed-out capture is cancelled so a late completion cannot persist bytes.
- Uniform all-white or all-black frames are rejected as `BLANK_SCREENSHOT`, allowing the caller to wait for rendering and retry within its normal observation budget.

## Adaptive use

The MCP should capture only for initial visual observation, canvas/dynamic content, low-confidence semantic targeting, meaningful state changes, or failed verification. Each capture returns a SHA-256 hash. Supplying that value as `previousHash` returns metadata without retransmitting image bytes when the image is unchanged.

## Privacy boundary

Capture is blocked before CDP image collection when the tab is internal/non-HTTP(S), incognito, marked private by the user, or contains a visible field identified as password, OTP, verification, PIN, payment-card, expiry, CVV/CVC, or another sensitive credential surface. The privacy scan covers the main document and embedded frames and fails closed if frame safety cannot be verified. Users can toggle **Mark current tab private** in the extension popup; the setting is local and removed when the tab closes.

## Deferred work

Full-page stitching, continuous video/desktop streaming, persistent image history, and unrestricted raw CDP remain out of scope. Milestone 4 will build a bounded `observe -> decide -> act -> verify` strategy on this primitive after signed Opera acceptance.
