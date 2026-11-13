import { NextRequest } from 'next/server';

const OPENROUTER_HOST = 'https://openrouter.ai';

async function handler(req: NextRequest) {
  const apiKey = req.headers.get('x-openrouter-api-key')?.trim();

  if (!apiKey) {
    return Response.json(
      { error: 'Missing OpenRouter API key.' },
      { status: 400 }
    );
  }

  const path = req.nextUrl.pathname.replace('/api/openrouter', '');

  // Restrict proxy exclusively to valid OpenRouter v1 API paths
  if (!path.startsWith('/api/v1/') || path.includes('..')) {
    return Response.json(
      { error: 'Invalid API endpoint requested.' },
      { status: 400 }
    );
  }

  const search = req.nextUrl.search;
  const url = `${OPENROUTER_HOST}${path}${search}`;

  try {
    const res = await fetch(url, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': req.headers.get('Content-Type') || 'application/json',
        'HTTP-Referer': req.headers.get('origin') || req.nextUrl.origin,
        'X-Title': 'Prince AI Studio',
      },
      body: req.method === 'GET' ? undefined : req.body,
      // @ts-expect-error - duplex is a valid option for streaming
      duplex: 'half',
      signal: req.signal,
    });

    return new Response(res.body, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'application/json',
        'Cache-Control': res.headers.get('Cache-Control') || 'no-store',
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return new Response(null, { status: 499 });
    }

    console.error('OpenRouter proxy error:', err);
    return Response.json(
      { error: 'Failed to communicate with OpenRouter upstream.' },
      { status: 502 }
    );
  }
}

export { handler as GET, handler as POST };
