'use client';

import React, { useState, useEffect } from 'react';
import { Brain, ChevronDown, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { cn } from '@/lib/utils';

export interface ThinkingAccordionProps {
  reasoning?: string | null;
  thinking?: string | null;
  isStreaming?: boolean;
  durationMs?: number;
}

export function ThinkingAccordion({
  reasoning,
  thinking,
  isStreaming = false,
  durationMs,
}: ThinkingAccordionProps) {
  const content = reasoning ?? thinking ?? '';
  // Open by default while streaming, closed by default once finished (unless user manually opened/closed)
  const [isOpen, setIsOpen] = useState(isStreaming);
  const [userInteracted, setUserInteracted] = useState(false);
  const [liveDuration, setLiveDuration] = useState(0);

  // Live timer while streaming reasoning
  useEffect(() => {
    if (!isStreaming) return;
    const start = Date.now();
    const interval = setInterval(() => {
      setLiveDuration(Math.floor((Date.now() - start) / 1000));
    }, 500);

    return () => clearInterval(interval);
  }, [isStreaming]);

  // Keep open while streaming, collapse once completed (unless user manually toggled it)
  useEffect(() => {
    if (userInteracted) return;
    setIsOpen(isStreaming);
  }, [isStreaming, userInteracted]);

  if (!content && !isStreaming) {
    return null;
  }

  const durationSeconds =
    durationMs !== undefined && durationMs > 0
      ? Math.max(1, Math.round(durationMs / 1000))
      : liveDuration > 0
        ? liveDuration
        : null;

  return (
    <div className="my-2.5 overflow-hidden rounded-xl border border-border/50 bg-muted/20 backdrop-blur-md shadow-[0_2px_10px_rgba(0,0,0,0.02),inset_0_1px_1px_rgba(255,255,255,0.08)] dark:bg-white/[0.02] dark:border-white/10 text-xs transition-all">
      <button
        type="button"
        onClick={() => {
          setUserInteracted(true);
          setIsOpen((prev) => !prev);
        }}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
      >
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <span className="relative flex h-3.5 w-3.5 items-center justify-center">
              <Sparkles className="h-3.5 w-3.5 text-primary animate-pulse" />
            </span>
          ) : (
            <Brain className="h-3.5 w-3.5 text-muted-foreground/80" />
          )}
          <span className="text-[12px] font-semibold tracking-tight">
            {isStreaming ? 'Thinking...' : 'Thought Process'}
          </span>
          {durationSeconds !== null && (
            <span className="rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {isStreaming ? `${durationSeconds}s` : `${durationSeconds}s`}
            </span>
          )}
        </div>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {isOpen && (
        <div className="border-t border-border/30 px-3.5 py-2.5 font-mono text-[11.5px] leading-relaxed text-muted-foreground/90 break-words max-h-96 overflow-y-auto">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
            components={{
              p: ({ node, ...props }) => <p className="mb-2 last:mb-0" {...props} />,
              pre: ({ node, ...props }) => (
                <pre className="my-1.5 overflow-x-auto rounded bg-zinc-950/80 p-2 text-zinc-300" {...props} />
              ),
              code: ({ node, ...props }) => (
                <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[11px]" {...props} />
              ),
            }}
          >
            {content || 'Thinking in progress...'}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}
