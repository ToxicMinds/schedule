import { createClient } from '@supabase/supabase-js';

function getEnv(name: string): string {
  const v = import.meta.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const supabaseUrl = getEnv('PUBLIC_SUPABASE_URL');
const supabaseKey = getEnv('PUBLIC_SUPABASE_PUBLISHABLE_KEY');

export const supabase = createClient(supabaseUrl, supabaseKey);
