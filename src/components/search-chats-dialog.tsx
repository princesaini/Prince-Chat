'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bot, Clock, MessageSquare, Search, X } from 'lucide-react';
import { ChatSession, formatRelativeTime } from '@/lib/chat-sessions';
import { cn } from '@/lib/utils';

export interface SearchChatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
}

export function SearchChatsDialog({
  open,
  onOpenChange,
  sessions,
  activeSessionId,
  onSelectSession,
}: SearchChatsDialogProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Sort most recent first when no query
      return [...sessions].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
    }

    return sessions
      .filter((s) => {
        const titleMatch = s.title.toLowerCase().includes(q);
        const messageMatch = s.messages.some((m) => m.content.toLowerCase().includes(q));
        return titleMatch || messageMatch;
      })
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  }, [sessions, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (filteredSessions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredSessions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredSessions.length) % filteredSessions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filteredSessions[selectedIndex];
      if (target) {
        onSelectSession(target.id);
        onOpenChange(false);
      }
    }
  };

  const getMatchingSnippet = (session: ChatSession, q: string): string | null => {
    if (!q) {
      const firstMsg = session.messages.find((m) => m.content?.trim());
      return firstMsg ? firstMsg.content.slice(0, 100) : null;
    }

    const matchingMsg = session.messages.find((m) =>
      m.content.toLowerCase().includes(q.toLowerCase())
    );
    if (!matchingMsg) return null;

    const lower = matchingMsg.content.toLowerCase();
    const idx = lower.indexOf(q.toLowerCase());
    const start = Math.max(0, idx - 30);
    const end = Math.min(matchingMsg.content.length, idx + q.length + 50);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < matchingMsg.content.length ? '...' : '';
    return prefix + matchingMsg.content.slice(start, end).trim() + suffix;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(94vw,36rem)] rounded-2xl border border-border/80 bg-popover/98 p-0 shadow-2xl backdrop-blur-xl gap-0 overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>Search conversations</DialogTitle>
        </DialogHeader>

        {/* Search Bar Input */}
        <div className="relative flex items-center border-b border-border/50 px-3.5 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground mr-2.5" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search conversations by title or message..."
            className="h-8 border-0 bg-transparent p-0 text-sm shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              ESC
            </kbd>
          )}
        </div>

        {/* Results List */}
        <ScrollArea className="max-h-[min(60vh,26rem)] p-2">
          {filteredSessions.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              {query ? `No conversations found for "${query}"` : 'No conversations found.'}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredSessions.map((session, index) => {
                const isActive = session.id === activeSessionId;
                const isSelected = index === selectedIndex;
                const snippet = getMatchingSnippet(session, query.trim());

                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => {
                      onSelectSession(session.id);
                      onOpenChange(false);
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      'flex w-full flex-col items-start gap-1 rounded-xl px-3 py-2.5 text-left transition-colors',
                      isSelected
                        ? 'bg-muted/80 text-foreground'
                        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                      isActive && 'border-l-2 border-foreground pl-2.5'
                    )}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate text-xs font-semibold text-foreground">
                          {session.title || 'Untitled Chat'}
                        </span>
                        {isActive && (
                          <span className="rounded-md bg-foreground/10 px-1.5 py-0.2 text-[9px] font-medium text-foreground">
                            Active
                          </span>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
                        <Clock className="h-3 w-3" />
                        <span>{formatRelativeTime(session.updatedAt || session.createdAt)}</span>
                      </div>
                    </div>

                    {snippet && (
                      <p className="line-clamp-2 text-[11px] text-muted-foreground/80 leading-relaxed pl-5">
                        {snippet}
                      </p>
                    )}

                    {session.modelId && (
                      <div className="flex items-center gap-1 pl-5 pt-0.5 text-[10px] text-muted-foreground/60 font-mono">
                        <Bot className="h-2.5 w-2.5" />
                        <span className="truncate max-w-[200px]">{session.modelId}</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Footer info bar */}
        <div className="flex items-center justify-between border-t border-border/40 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
          <span>
            {filteredSessions.length} conversation{filteredSessions.length === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/70">
            <span>Use ↑↓ to navigate</span>
            <span>·</span>
            <span>↵ to select</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
