# Housing Supabase project

This directory belongs to the standalone Housing application served at `/housing`.
It must not be linked or pushed to the VisaFlow Supabase project.

## Setup

1. Create a new Supabase project.
2. Open its SQL editor and run `migrations/0001_housing_initial.sql`.
3. Add the project URL and publishable key to the Housing environment variables.
4. Create the first account from the Housing login screen and initialize its workspace.

Never expose or add a service-role key to the browser application.
