'use server';

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
  const search = req.nextUrl.search;
  const url = `${OPENROUTER_HOST}${path}${search}`;

  const res = await fetch(url, {
    method: req.method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': req.headers.get('Content-Type') || 'application/json',
      'HTTP-Referer': req.headers.get('origin') || req.nextUrl.origin,
      'X-Title': 'Prince Chat',
    },
    body: req.method === 'GET' ? undefined : req.body,
    // @ts-expect-error - duplex is a valid option for streaming
    duplex: 'half',
  });

  return new Response(res.body, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/json',
      'Cache-Control': res.headers.get('Cache-Control') || 'no-store',
    },
  });
}

export { handler as GET, handler as POST };
