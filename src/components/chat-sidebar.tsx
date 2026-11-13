'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Check,
  MessageSquare,
  PanelLeftClose,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import {
  ChatSession,
  formatRelativeTime,
  groupSessionsByDate,
} from '@/lib/chat-sessions';
import { cn } from '@/lib/utils';

export interface ChatSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, newTitle: string) => void;
  onClearAllSessions: () => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  isMobile: boolean;
  isLoading: boolean;
}

interface SidebarContentProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, newTitle: string) => void;
  onClearAllSessions: () => void;
  onClose?: () => void;
  isLoading: boolean;
}

function SidebarInner({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  onRenameSession,
  onClearAllSessions,
  onClose,
  isLoading,
}: SidebarContentProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [sessionIdToDelete, setSessionIdToDelete] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingSessionId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingSessionId]);

  const handleStartRename = (session: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditingTitle(session.title);
  };

  const handleSaveRename = (id: string) => {
    const trimmed = editingTitle.trim();
    if (trimmed) {
      onRenameSession(id, trimmed);
    }
    setEditingSessionId(null);
    setEditingTitle('');
  };

  const handleCancelRename = () => {
    setEditingSessionId(null);
    setEditingTitle('');
  };

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase().trim();
    return sessions.filter((s) => {
      const matchTitle = s.title.toLowerCase().includes(q);
      const matchMessage = s.messages?.some((m) =>
        m.content?.toLowerCase().includes(q)
      );
      return matchTitle || matchMessage;
    });
  }, [sessions, searchQuery]);

  const dateGroups = useMemo(
    () => groupSessionsByDate(filteredSessions),
    [filteredSessions]
  );

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground select-none">
      {/* Top Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/40 px-3.5">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-semibold tracking-tight text-foreground">
            Chat History
          </span>
        </div>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close sidebar"
            title="Close sidebar"
            className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* New Chat Button */}
      <div className="p-3">
        <Button
          onClick={onNewChat}
          disabled={isLoading}
          variant="outline"
          className="h-9 w-full justify-between rounded-xl border border-border/60 bg-card/60 px-3 text-xs font-medium text-foreground backdrop-blur-md shadow-[0_2px_8px_rgba(0,0,0,0.02),inset_0_1px_1px_rgba(255,255,255,0.15)] transition-all hover:border-border hover:bg-card/90 disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.03] dark:shadow-[0_2px_10px_rgba(0,0,0,0.2),inset_0_1px_1px_rgba(255,255,255,0.06)] dark:hover:bg-white/[0.06]"
        >
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 shrink-0 text-foreground" />
            <span>New Chat</span>
          </div>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/80">
            Ctrl+Shift+O
          </kbd>
        </Button>
      </div>

      {/* Search Input */}
      {sessions.length > 0 && (
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations... (Ctrl+K)"
              className="h-8 rounded-lg border-border/50 bg-muted/40 pl-8 pr-7 text-xs backdrop-blur-md placeholder:text-muted-foreground/60 transition-all dark:border-white/10 dark:bg-white/[0.03]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sessions List */}
      <ScrollArea className="flex-1">
        <div className="space-y-4 px-2.5 py-1">
          {filteredSessions.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              {searchQuery
                ? 'No conversations found.'
                : 'No saved conversations yet.'}
            </div>
          ) : (
            dateGroups.map((group) => (
              <div key={group.label} className="space-y-0.5">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.sessions.map((session) => {
                    const isActive = session.id === activeSessionId;
                    const isEditing = session.id === editingSessionId;

                    return (
                      <div
                        key={session.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (!isEditing) {
                            onSelectSession(session.id);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (!isEditing && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            onSelectSession(session.id);
                          }
                        }}
                        className={cn(
                          'group relative flex items-center justify-between gap-1.5 rounded-xl px-2.5 py-2 text-xs transition-all cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring',
                          isActive
                            ? 'bg-accent/80 text-accent-foreground font-medium shadow-[0_2px_10px_rgba(0,0,0,0.03),inset_0_1px_1px_rgba(255,255,255,0.15)] backdrop-blur-md border border-border/50 dark:bg-white/[0.07] dark:border-white/10 dark:shadow-[0_2px_12px_rgba(0,0,0,0.25),inset_0_1px_1px_rgba(255,255,255,0.08)]'
                            : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground dark:hover:bg-white/[0.03]'
                        )}
                      >
                        {isEditing ? (
                          <div
                            className="flex flex-1 items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Input
                              ref={editInputRef}
                              value={editingTitle}
                              onChange={(e) => setEditingTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSaveRename(session.id);
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  handleCancelRename();
                                }
                              }}
                              className="h-6 flex-1 rounded-md border-border/80 bg-background px-1.5 text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveRename(session.id)}
                              className="rounded p-1 text-emerald-500 hover:bg-muted"
                              aria-label="Save title"
                            >
                              <Check className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelRename}
                              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                              aria-label="Cancel rename"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="min-w-0 flex-1 pr-1.5">
                              <p className="truncate text-xs leading-snug">
                                {session.title || 'Untitled Chat'}
                              </p>
                              <span className="text-[10px] text-muted-foreground/60">
                                {formatRelativeTime(session.updatedAt || session.createdAt)}
                              </span>
                            </div>

                            {/* Action Buttons (Visible on hover or if active) */}
                            <div
                              className={cn(
                                'flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity',
                                'group-hover:opacity-100',
                                isActive && 'opacity-100'
                              )}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={(e) => handleStartRename(session, e)}
                                className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                                title="Rename conversation"
                                aria-label="Rename conversation"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSessionIdToDelete(session.id);
                                }}
                                className="rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
                                title="Delete conversation"
                                aria-label="Delete conversation"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      {sessions.length > 0 && (
        <div className="flex items-center justify-between border-t border-border/40 p-3 text-[11px] text-muted-foreground">
          <span>
            {sessions.length} conversation{sessions.length === 1 ? '' : 's'}
          </span>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                className="text-[11px] text-muted-foreground/80 transition-colors hover:text-destructive"
              >
                Clear all
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent className="rounded-2xl border border-border/80 bg-card p-5 sm:max-w-sm">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-base font-semibold">
                  Clear all chat history?
                </AlertDialogTitle>
                <AlertDialogDescription className="text-xs text-muted-foreground">
                  This will permanently delete all your saved conversations and messages. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="h-8 rounded-lg text-xs">
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={onClearAllSessions}
                  className="h-8 rounded-lg bg-destructive px-3 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
                >
                  Clear all
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {/* Individual Session Delete Confirmation Dialog */}
      <AlertDialog
        open={Boolean(sessionIdToDelete)}
        onOpenChange={(open) => {
          if (!open) setSessionIdToDelete(null);
        }}
      >
        <AlertDialogContent className="rounded-2xl border border-border/80 bg-card p-5 sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-semibold">
              Delete this chat?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground">
              This conversation will be permanently removed from your chat history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 rounded-lg text-xs">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (sessionIdToDelete) {
                  onDeleteSession(sessionIdToDelete);
                  setSessionIdToDelete(null);
                }
              }}
              className="h-8 rounded-lg bg-destructive px-3 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function ChatSidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  onRenameSession,
  onClearAllSessions,
  isOpen,
  onToggleOpen,
  isMobile,
  isLoading,
}: ChatSidebarProps) {
  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={onToggleOpen}>
        <SheetContent side="left" className="w-[85vw] max-w-xs p-0 border-r border-border/60">
          <SidebarInner
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectSession={onSelectSession}
            onNewChat={onNewChat}
            onDeleteSession={onDeleteSession}
            onRenameSession={onRenameSession}
            onClearAllSessions={onClearAllSessions}
            onClose={onToggleOpen}
            isLoading={isLoading}
          />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside
      className={cn(
        'relative flex h-full shrink-0 flex-col border-r border-border/30 bg-card/30 backdrop-blur-2xl transition-all duration-200 ease-in-out shadow-[1px_0_12px_rgba(0,0,0,0.02)] dark:border-white/5 dark:bg-zinc-950/30',
        isOpen ? 'w-72 sm:w-80' : 'w-0 border-r-0 overflow-hidden'
      )}
      aria-hidden={!isOpen}
    >
      <div className="w-72 sm:w-80 h-full flex flex-col">
        <SidebarInner
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={onSelectSession}
          onNewChat={onNewChat}
          onDeleteSession={onDeleteSession}
          onRenameSession={onRenameSession}
          onClearAllSessions={onClearAllSessions}
          onClose={onToggleOpen}
          isLoading={isLoading}
        />
      </div>
    </aside>
  );
}
