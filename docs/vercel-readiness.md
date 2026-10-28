# Vercel deployment readiness

The repository is tested as a local Node application. Connecting it to Vercel
alone will not supply the following requirements:

1. Replace the encrypted local session and operations stores with durable,
   shared server-side storage. Vercel function instances do not preserve local
   runtime files between instances/restarts.
2. Export an Express/serverless entrypoint without `app.listen` and prevent
   background timers from running inside cloud request functions.
3. Run fingerprint TCP/UDP access and periodic fallback delivery in the gym's
   local bridge. Vercel cannot reach the gym's private LAN address. Use scoped,
   authenticated job requests and status polling between cloud and bridge.
4. Configure server-only Supabase/Google credentials in hosting environment
   variables; preserve Supabase RLS and staff role checks. Never publish secret
   keys to static JavaScript or NEXT_PUBLIC variables.
5. Decide how the requested login-free forms will be accessed on a public host.
   The current exception is deliberately local-network-only; it does not grant
   anonymous public internet access to gym records or the device.
6. Verify HTTPS cookies, production origins, persistent login/refresh behavior,
   role access and mobile/tablet views on the hosted deployment.

These tasks require a cloud adaptation pass before a working Vercel deployment.
The existing GitHub Pages site and repository are left unchanged.
