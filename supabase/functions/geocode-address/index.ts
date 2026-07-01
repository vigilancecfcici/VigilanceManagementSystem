import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { enforceSecurityGuard } from '../_shared/authGuard.ts';
import { geocodeAddressText } from '../_shared/geocodeAddress.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const authDenied = await enforceSecurityGuard(req, { allowedRoles: ['admin', 'management'] });
  if (authDenied) return authDenied;

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    const body = await req.json() as { address?: string };
    const address = body.address?.trim() ?? '';
    if (address.length < 10) {
      return new Response(JSON.stringify({ error: 'Address is too short' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const result = await geocodeAddressText(address);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Geocoding failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
});
