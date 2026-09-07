# Legacy: Local Opera Agent v3.0 Final 2

Historical release and the main technical reference for the rebuild.

## Highlights

- Supabase Edge cross-chat gateway.
- Trusted debugger input.
- Persistent YouTube auto-skip policy.
- Faster YouTube playback and search paths.
- Improved recommendation parser.
- Context-safe content scripts.
- Multi-page `parallel_read`.
- Successful full sitemap crawl testing.

## Verified examples

- YouTube recommendation playback and ad skipping.
- Closed Captions control interaction through trusted input.
- Full sitemap crawl of 180 URLs with 180 successes and 0 failures during testing.

## Known limitations

- Returned semantic text could be capped at about 2400 characters.
- Some synchronous gateway calls could time out at about 5 seconds while the local command continued successfully.
- UI state such as `aria-pressed` was not always exposed.
- Some direct primitives were not consistently available in the flow runner.

## Rebuild lessons

Opera Agent should keep the extension thin, expose consistent generic primitives, return richer element state, support bounded chunked reads, and move high-level orchestration to Supabase.
