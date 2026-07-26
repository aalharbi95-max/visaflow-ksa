-- Remove the temporary broad AI-interview Storage policies after the secure
-- Edge-mediated signed URL flow is deployed.
drop policy if exists "VisaFlow AI audio temporary insert" on storage.objects;
drop policy if exists "VisaFlow AI audio temporary read" on storage.objects;
drop policy if exists "VisaFlow AI audio temporary update" on storage.objects;

-- No replacement browser policy is intentional. Only service_role Edge
-- Functions may issue exact-path, short-lived signed URLs for this bucket.
