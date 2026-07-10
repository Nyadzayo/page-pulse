/**
 * GA4 Measurement Protocol credentials for anonymous product telemetry.
 *
 * Values come from a local `.env` file (gitignored) so the secret never
 * enters git history — see `.env.example`. Vite inlines them into the
 * built bundle at `npm run build` time, so the zip submitted to the
 * Chrome Web Store is self-contained. With no `.env` present, both
 * values are empty and the telemetry module is a silent no-op.
 *
 * IMPORTANT: publish the updated privacy policy and store listing
 * (privacy-policy.html / store-listing.md) in the same release that
 * ships a configured build. Shipping telemetry while the listing
 * still says "No analytics" is a Chrome Web Store policy violation.
 */
export const TELEMETRY_MEASUREMENT_ID =
  import.meta.env?.VITE_TELEMETRY_MEASUREMENT_ID || '';
export const TELEMETRY_API_SECRET =
  import.meta.env?.VITE_TELEMETRY_API_SECRET || '';
