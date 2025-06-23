'use server';

import {NextRequest} from 'next/server';

// This route acts as a proxy to the Ollama API to avoid CORS issues.
const OLLAMA_HOST = 'http://127.0.0.1:11434';

async function handler(req: NextRequest) {
  const path = req.nextUrl.pathname.replace('/api/ollama', '');
  const url = `${OLLAMA_HOST}${path}`;

  const res = await fetch(url, {
    method: req.method,
    headers: {
      'Content-Type': req.headers.get('Content-Type') || 'application/json',
    },
    body: req.body,
    // @ts-expect-error - duplex is a valid option for streaming
    duplex: 'half',
  });

  return new Response(res.body, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/json',
    },
  });
}

export {handler as GET, handler as POST};
