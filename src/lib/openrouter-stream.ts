import { ReasoningEffort } from './chat-sessions';

export interface StreamChatCompletionOptions {
  apiKey: string;
  modelId: string;
  messages: unknown[];
  systemPrompt?: string;
  webSearchEnabled?: boolean;
  reasoningEffort?: ReasoningEffort | '';
  signal?: AbortSignal;
  onTextChunk: (text: string) => void;
  onReasoningChunk?: (reasoning: string) => void;
  onUsage?: (usage: unknown) => void;
}

export async function streamChatCompletion({
  apiKey,
  modelId,
  messages,
  systemPrompt,
  webSearchEnabled,
  reasoningEffort,
  signal,
  onTextChunk,
  onReasoningChunk,
  onUsage,
}: StreamChatCompletionOptions): Promise<void> {
  const response = await fetch('/api/openrouter/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-openrouter-api-key': apiKey.trim(),
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        ...(systemPrompt?.trim()
          ? [{ role: 'system', content: systemPrompt.trim() }]
          : []),
        ...messages,
      ],
      stream: true,
      ...(webSearchEnabled ? { tools: [{ type: 'openrouter:web_search' }] } : {}),
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    }),
    signal,
  });

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json();
      errorDetail = errJson?.error?.message || errJson?.error || '';
    } catch {
      // Ignore JSON parse error
    }
    throw new Error(errorDetail || `Request failed with status ${response.status}`);
  }

  if (!response.body) {
    throw new Error('Response body is empty.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bufferedChunk = '';

  const processChunk = (chunkStr: string) => {
    const events = chunkStr.split(/\r?\n\r?\n/);
    const remainder = events.pop() ?? '';

    for (const event of events) {
      const trimmed = event.trim();
      if (!trimmed) continue;

      const dataLines = trimmed
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6).trim());

      for (const line of dataLines) {
        if (!line || line === '[DONE]') continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.error?.message) {
            throw new Error(parsed.error.message);
          }

          const delta = parsed.choices?.[0]?.delta;
          const reasoning = delta?.reasoning || delta?.reasoning_content;
          const content = delta?.content;

          if (reasoning && onReasoningChunk) {
            onReasoningChunk(reasoning);
          }
          if (content) {
            onTextChunk(content);
          }
          if (parsed.usage && onUsage) {
            onUsage(parsed.usage);
          }
        } catch (err) {
          if (err instanceof Error && err.message) {
            throw err;
          }
        }
      }
    }
    return remainder;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bufferedChunk = processChunk(bufferedChunk + decoder.decode(value, { stream: true }));
  }

  const finalChunk = bufferedChunk + decoder.decode();
  if (finalChunk.trim()) {
    processChunk(`${finalChunk}\n\n`);
  }
}
