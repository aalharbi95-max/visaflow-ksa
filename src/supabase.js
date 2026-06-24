import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://zeocbftriydodzfgixjv.supabase.co'
const supabaseKey = 'sb_publishable_b5oQYxCWh6pwJsf8zDvDFA_HEcuoHCj'

export const supabase = createClient(supabaseUrl, supabaseKey)