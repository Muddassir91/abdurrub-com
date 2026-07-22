export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204);
    }

    if (request.method !== 'POST') {
      return corsResponse({ ok: false, error: 'Method not allowed' }, 405);
    }

    let data;
    try {
      data = await request.json();
    } catch (error) {
      return corsResponse({ ok: false, error: 'Invalid JSON' }, 400);
    }

    const lead = normalizeLead(data);

    if (env.DTC_LEADS) {
      await env.DTC_LEADS.put(lead.session_id + ':' + lead.event + ':' + Date.now(), JSON.stringify(lead));
    }

    return corsResponse({ ok: true, qualified: lead.qualified, lead_type: lead.lead_type });
  }
};

function normalizeLead(data) {
  const answers = data.answers || {};
  const revenueQualified = ['1m_3m', '3m_10m', '10m_plus'].includes(answers.annual_revenue);
  const teamQualified = ['2_5', '6_15', '16_50', '51_plus'].includes(answers.team_size);
  const urlQualified = isStoreUrl(answers.website_url);
  const qualified = revenueQualified && teamQualified && urlQualified;

  return {
    event: String(data.event || 'unknown'),
    session_id: String(data.session_id || crypto.randomUUID()),
    page: 'dtc_qualifier',
    lead_type: qualified ? 'true_lead' : 'not_fit_or_fake',
    qualified,
    annual_revenue: String(answers.annual_revenue || ''),
    team_size: String(answers.team_size || ''),
    website_url: String(answers.website_url || ''),
    source_url: String(data.source_url || ''),
    referrer: String(data.referrer || ''),
    started_at: String(data.started_at || ''),
    sent_at: String(data.sent_at || new Date().toISOString())
  };
}

function isStoreUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname.includes('.') && parsed.hostname.length > 4;
  } catch (error) {
    return false;
  }
}

function corsResponse(body, status = 200) {
  return new Response(body ? JSON.stringify(body) : null, {
    status,
    headers: {
      'Access-Control-Allow-Origin': 'https://abdurrub.com',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    }
  });
}
