-- Trust & Safety dashboard policies.
-- Run after the customer app's backend/schema.sql.
-- Set app_metadata.role = 'safety_team' on each operator's Auth user.
-- Never use a service-role key in the browser.

create policy "safety team can read customers" on public.customers
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'safety_team');

create policy "safety team can read listings" on public.listings
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'safety_team');

create policy "safety team can read bookings" on public.bookings
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'safety_team');

create policy "safety team can read chatbot requests" on public.chatbot_requests
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'safety_team');

create policy "safety team can read trust safety reports" on public.trust_safety
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'safety_team');

create policy "safety team can update trust safety status" on public.trust_safety
  for update to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'safety_team')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'safety_team');

revoke update on public.trust_safety from authenticated;
grant update (flag_status) on public.trust_safety to authenticated;
