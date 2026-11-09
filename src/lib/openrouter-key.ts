export interface OpenRouterKeyInfo {
  label?: string;
  usage?: number;
  limit?: number | null;
  isFreeTier?: boolean;
  is_free_tier?: boolean;
  rateLimit?: {
    requests: number;
    interval: string;
  };
  rate_limit?: {
    requests: number;
    interval: string;
  };
  totalCredits?: number;
  total_credits?: number;
  remainingCredits?: number | null;
  remaining_credits?: number | null;
}

export async function fetchOpenRouterKeyInfo(apiKey: string): Promise<OpenRouterKeyInfo | null> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) return null;

  const headers = {
    'x-openrouter-api-key': trimmedKey,
  };

  let keyData: {
    label?: string;
    usage?: number;
    limit?: number | null;
    is_free_tier?: boolean;
    rate_limit?: { requests: number; interval: string };
  } | null = null;

  let creditsData: {
    total_credits?: number;
    total_usage?: number;
  } | null = null;

  try {
    const keyRes = await fetch('/api/openrouter/api/v1/auth/key', { headers });
    if (keyRes.ok) {
      const json = await keyRes.json();
      keyData = json?.data || null;
    }
  } catch (err) {
    console.warn('Failed to fetch OpenRouter auth key info', err);
  }

  try {
    const creditsRes = await fetch('/api/openrouter/api/v1/credits', { headers });
    if (creditsRes.ok) {
      const json = await creditsRes.json();
      creditsData = json?.data || null;
    }
  } catch (err) {
    console.warn('Failed to fetch OpenRouter credits info', err);
  }

  if (!keyData && !creditsData) {
    return null;
  }

  let remainingCredits: number | null = null;
  if (
    creditsData &&
    typeof creditsData.total_credits === 'number' &&
    typeof creditsData.total_usage === 'number'
  ) {
    remainingCredits = Math.max(0, creditsData.total_credits - creditsData.total_usage);
  } else if (
    keyData &&
    typeof keyData.limit === 'number' &&
    typeof keyData.usage === 'number'
  ) {
    remainingCredits = Math.max(0, keyData.limit - keyData.usage);
  }

  return {
    label: keyData?.label,
    usage: keyData?.usage ?? creditsData?.total_usage,
    limit: keyData?.limit,
    isFreeTier: keyData?.is_free_tier,
    is_free_tier: keyData?.is_free_tier,
    rateLimit: keyData?.rate_limit,
    rate_limit: keyData?.rate_limit,
    totalCredits: creditsData?.total_credits,
    total_credits: creditsData?.total_credits,
    remainingCredits,
    remaining_credits: remainingCredits,
  };
}
