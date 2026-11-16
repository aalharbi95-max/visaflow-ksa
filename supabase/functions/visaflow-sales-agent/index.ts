import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createSalesHandler } from "../_shared/salesAgentRuntime.mjs";

// Authenticated, draft-only endpoint. No worker secret or email-dispatch capability.
serve(createSalesHandler({ createClient, env: (name: string) => Deno.env.get(name) }));
