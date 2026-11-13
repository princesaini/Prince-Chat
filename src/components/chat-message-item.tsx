'use client';

import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import hljs from 'highlight.js/lib/common';
import {
  Check,
  Copy,
  FileText,
  Pencil,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ThinkingAccordion } from '@/components/thinking-accordion';
import { Message } from '@/lib/chat-sessions';
import { cn } from '@/lib/utils';

export function formatTokenCount(tokens: number) {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return tokens.toLocaleString();
}

export function formatEstimatedCost(cost: number) {
  if (cost < 0.0001) {
    return `<$0.0001`;
  }
  const maximumFractionDigits = cost < 0.01 ? 4 : 2;
  return `$${cost.toLocaleString(undefined, { maximumFractionDigits })}`;
}

export function parseContentAndThinking(message: Message): {
  displayReasoning: string | null;
  displayContent: string;
} {
  if (message.reasoning) {
    return {
      displayReasoning: message.reasoning,
      displayContent: message.content,
    };
  }

  const thinkMatch = message.content.match(/^<think>([\s\S]*?)(?:<\/think>|$)([\s\S]*)$/);
  if (thinkMatch) {
    return {
      displayReasoning: thinkMatch[1].trim(),
      displayContent: thinkMatch[2].trimStart(),
    };
  }

  return {
    displayReasoning: null,
    displayContent: message.content,
  };
}

export function CodeSnippet({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const language = className ? className.replace(/language-/, '') : '';
  const textContent = String(children).replace(/\n$/, '');

  const copyCode = () => {
    navigator.clipboard.writeText(textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const highlightedCode = useMemo(() => {
    if (!textContent) return '';
    try {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(textContent, { language, ignoreIllegals: true }).value;
      }
      if (textContent.length < 5000) {
        return hljs.highlightAuto(textContent).value;
      }
      return '';
    } catch {
      return '';
    }
  }, [textContent, language]);

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-white/10 bg-zinc-950/80 text-zinc-100 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.3),inset_0_1px_1px_rgba(255,255,255,0.08)]">
      <div className="flex items-center justify-between border-b border-white/[0.08] bg-zinc-900/60 px-3.5 py-1.5 text-xs text-zinc-400 backdrop-blur-md">
        <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={copyCode}
          className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 font-mono text-[12.5px] leading-relaxed text-zinc-200">
        {highlightedCode ? (
          <code
            className={cn('hljs', language && `language-${language}`)}
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
          />
        ) : (
          <code>{children}</code>
        )}
      </pre>
    </div>
  );
}

// Static plugin and components definitions to avoid AST re-parsing on every render
const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS: [typeof rehypeKatex, { throwOnError: boolean }][] = [
  [rehypeKatex, { throwOnError: false }],
];

const MARKDOWN_COMPONENTS = {
  p: ({ node, ...props }: React.HTMLAttributes<HTMLParagraphElement> & { node?: unknown }) => (
    <p className="mb-2 last:mb-0 leading-relaxed text-foreground" {...props} />
  ),
  ol: ({ node, ...props }: React.OlHTMLAttributes<HTMLOListElement> & { node?: unknown }) => (
    <ol className="my-2 ml-4 list-decimal space-y-1 text-foreground" {...props} />
  ),
  ul: ({ node, ...props }: React.HTMLAttributes<HTMLUListElement> & { node?: unknown }) => (
    <ul className="my-2 ml-4 list-disc space-y-1 text-foreground" {...props} />
  ),
  li: ({ node, ...props }: React.LiHTMLAttributes<HTMLLIElement> & { node?: unknown }) => (
    <li className="leading-relaxed" {...props} />
  ),
  code: ({
    node,
    className,
    children,
    ...props
  }: React.HTMLAttributes<HTMLElement> & { node?: unknown; className?: string }) =>
    className ? (
      <CodeSnippet className={className}>{children}</CodeSnippet>
    ) : (
      <code
        className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[12px] text-foreground"
        {...props}
      >
        {children}
      </code>
    ),
};

export interface ChatMessageItemProps {
  message: Message;
  index: number;
  totalMessages: number;
  isCurrentlyStreaming: boolean;
  isLoading: boolean;
  isEditing: boolean;
  editingMessageContent: string;
  onEditMessage: (index: number) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditingContentChange: (val: string) => void;
  onCopy: (text: string) => void;
  onRegenerate: (index: number) => void;
  onOpenRetryPicker: (index: number) => void;
}

function ChatMessageItemComponent({
  message,
  index,
  totalMessages,
  isCurrentlyStreaming,
  isLoading,
  isEditing,
  editingMessageContent,
  onEditMessage,
  onSaveEdit,
  onCancelEdit,
  onEditingContentChange,
  onCopy,
  onRegenerate,
  onOpenRetryPicker,
}: ChatMessageItemProps) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="group flex flex-col items-end">
        <div className="flex max-w-[85%] flex-col items-end sm:max-w-[75%]">
          {/* User Attachments */}
          {message.attachments && message.attachments.length > 0 ? (
            <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
              {message.attachments.map((attachment) =>
                attachment.kind === 'image' ? (
                  <div
                    key={attachment.id}
                    className="overflow-hidden rounded-xl border border-border/60 bg-muted/30"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={attachment.dataUrl}
                      alt={attachment.name}
                      className="max-h-48 w-auto object-contain"
                    />
                  </div>
                ) : (
                  <div
                    key={attachment.id}
                    className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1 text-xs"
                  >
                    <FileText className="h-3 w-3 text-muted-foreground" />
                    <span className="truncate">{attachment.name}</span>
                  </div>
                )
              )}
            </div>
          ) : null}

          {/* Inline Editing vs Normal View */}
          {isEditing ? (
            <div className="w-full min-w-[260px] rounded-2xl border border-border/80 bg-muted/40 p-2.5 sm:min-w-[340px]">
              <Textarea
                value={editingMessageContent}
                onChange={(e) => onEditingContentChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    onSaveEdit();
                  } else if (e.key === 'Escape') {
                    onCancelEdit();
                  }
                }}
                className="min-h-[64px] resize-y rounded-xl border-border/60 bg-background text-xs"
                placeholder="Edit your prompt..."
                autoFocus
              />
              <div className="mt-2 flex items-center justify-end gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onCancelEdit}
                  className="h-6 rounded-md px-2 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={onSaveEdit}
                  disabled={!editingMessageContent.trim() || isLoading}
                  className="h-6 rounded-md bg-foreground px-2 text-[11px] font-medium text-background hover:bg-foreground/90 disabled:opacity-30"
                >
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <div className="relative rounded-2xl border border-border/50 bg-secondary/60 px-3.5 py-2 text-sm leading-relaxed text-foreground backdrop-blur-md shadow-[0_2px_12px_rgba(0,0,0,0.03),inset_0_1px_1px_rgba(255,255,255,0.15)] dark:bg-zinc-800/60 dark:border-white/10 dark:shadow-[0_2px_16px_rgba(0,0,0,0.25),inset_0_1px_1px_rgba(255,255,255,0.08)]">
              <div className="whitespace-pre-wrap break-words">{message.content}</div>

              {/* Hover Action Bar */}
              <div className="mt-1 flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => onEditMessage(index)}
                  disabled={isLoading}
                  aria-label="Edit message"
                  title="Edit prompt"
                  className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => onCopy(message.content)}
                  aria-label="Copy prompt"
                  title="Copy prompt"
                  className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Assistant Message
  const { displayReasoning, displayContent } = parseContentAndThinking(message);
  const hasReasoning = Boolean(displayReasoning || (isCurrentlyStreaming && message.reasoning));
  const isThinkingStreaming = isCurrentlyStreaming && !displayContent && hasReasoning;
  const showFooter = (displayContent || displayReasoning) && (index < totalMessages - 1 || !isLoading);

  return (
    <div className="group flex flex-col items-start">
      <div className="w-full max-w-full">
        {/* Generated Images */}
        {message.images && message.images.length > 0 ? (
          <div className="my-2 grid gap-2.5 sm:grid-cols-2">
            {message.images.map((image, imageIndex) => (
              <div
                key={`${image.url.slice(0, 32)}-${imageIndex}`}
                className="overflow-hidden rounded-xl border border-border/60 bg-muted/20"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt={`Generated ${imageIndex + 1}`}
                  className="h-auto w-full object-cover"
                />
              </div>
            ))}
          </div>
        ) : null}

        {/* Collapsible Thinking / Reasoning Accordion */}
        {hasReasoning ? (
          <ThinkingAccordion
            thinking={displayReasoning}
            isStreaming={isThinkingStreaming}
            durationMs={message.reasoningTimeMs}
          />
        ) : null}

        {/* Markdown Body */}
        {displayContent ? (
          <div className="prose prose-zinc dark:prose-invert max-w-none text-[13.5px] leading-relaxed break-words">
            <ReactMarkdown
              remarkPlugins={REMARK_PLUGINS}
              rehypePlugins={REHYPE_PLUGINS}
              components={MARKDOWN_COMPONENTS}
            >
              {displayContent}
            </ReactMarkdown>
          </div>
        ) : isCurrentlyStreaming && !hasReasoning ? (
          <div className="flex items-center gap-1.5 py-2 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-foreground animate-ping" />
            <span>Generating...</span>
          </div>
        ) : null}

        {/* Assistant Footer */}
        {showFooter ? (
          <div className="mt-1.5 flex items-center justify-between gap-3 pt-1">
            {message.usage ? (
              <span
                className="text-[10px] text-muted-foreground/75 font-mono"
                title={`In: ${message.usage.inputTokens.toLocaleString()} · Out: ${message.usage.outputTokens.toLocaleString()}${message.usage.estimatedCost !== null ? ` · Cost: ${formatEstimatedCost(message.usage.estimatedCost)}` : ''}`}
              >
                {formatTokenCount(message.usage.inputTokens)} in ·{' '}
                {formatTokenCount(message.usage.outputTokens)} out
                {message.usage.estimatedCost !== null
                  ? ` · ≈ ${formatEstimatedCost(message.usage.estimatedCost)}`
                  : ''}
              </span>
            ) : (
              <span />
            )}

            <div className="flex items-center gap-1 opacity-70 transition-opacity hover:opacity-100">
              {!message.images ? (
                <>
                  <button
                    type="button"
                    onClick={() => onRegenerate(index)}
                    disabled={isLoading}
                    aria-label="Regenerate response"
                    title="Regenerate"
                    className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenRetryPicker(index)}
                    disabled={isLoading}
                    aria-label="Retry with another model"
                    title="Try another model"
                    className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                </>
              ) : null}
              <button
                type="button"
                onClick={() => onCopy(displayContent || message.content)}
                aria-label="Copy response"
                title="Copy response"
                className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const ChatMessageItem = React.memo(
  ChatMessageItemComponent,
  (prevProps, nextProps) => {
    // If message reference or content changed, re-render
    if (prevProps.message !== nextProps.message) return false;
    if (prevProps.isCurrentlyStreaming !== nextProps.isCurrentlyStreaming) return false;
    if (prevProps.isEditing !== nextProps.isEditing) return false;
    if (nextProps.isEditing && prevProps.editingMessageContent !== nextProps.editingMessageContent) {
      return false;
    }
    if (prevProps.isLoading !== nextProps.isLoading) return false;
    if (prevProps.totalMessages !== nextProps.totalMessages) return false;

    return true;
  }
);
