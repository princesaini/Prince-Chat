'use client';

import React from 'react';
import { UseFormReturn } from 'react-hook-form';
import {
  ArrowUp,
  Brain,
  FileText,
  Globe,
  Image as ImageIcon,
  Paperclip,
  Square,
  X,
} from 'lucide-react';
import { Attachment, ReasoningEffort } from '@/lib/chat-sessions';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';

export interface ChatComposerProps {
  form: UseFormReturn<{ message: string }>;
  isLoading: boolean;
  openRouterApiKey: string;
  selectedModelOutputsImage: boolean;
  selectedModelSupportsAttachments: boolean;
  selectedModelSupportsImageInput: boolean;
  attachmentAccept: string;
  pendingAttachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  onAttachmentChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  attachmentInputRef: React.RefObject<HTMLInputElement>;
  composerTextareaRef: React.RefObject<HTMLTextAreaElement>;
  webSearchEnabled: boolean;
  onToggleWebSearch: () => void;
  selectedModelSupportsReasoningEffort: boolean;
  reasoningEffortOptions: ReasoningEffort[];
  effectiveReasoningEffort: ReasoningEffort | '';
  modelDefaultEffort: ReasoningEffort | '';
  formatEffortLabel: (effort?: string | null) => string;
  onSelectReasoningEffort: (effort: ReasoningEffort) => void;
  onSubmit: (values: { message: string }) => void;
  onStop: () => void;
}

export function ChatComposer({
  form,
  isLoading,
  openRouterApiKey,
  selectedModelOutputsImage,
  selectedModelSupportsAttachments,
  selectedModelSupportsImageInput,
  attachmentAccept,
  pendingAttachments,
  onRemoveAttachment,
  onAttachmentChange,
  attachmentInputRef,
  composerTextareaRef,
  webSearchEnabled,
  onToggleWebSearch,
  selectedModelSupportsReasoningEffort,
  reasoningEffortOptions,
  effectiveReasoningEffort,
  modelDefaultEffort,
  formatEffortLabel,
  onSelectReasoningEffort,
  onSubmit,
  onStop,
}: ChatComposerProps) {
  return (
    <footer className="shrink-0 bg-gradient-to-t from-background via-background/90 to-transparent pb-3 pt-2">
      <div className="mx-auto w-full max-w-3xl px-3 sm:px-4">
        {/* Pending Attachments Tray */}
        {pendingAttachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 px-1">
            {pendingAttachments.map((att) => (
              <div
                key={att.id}
                className="group relative flex items-center gap-1.5 rounded-xl border border-border/80 bg-muted/60 py-1 pl-2 pr-1.5 text-xs text-foreground shadow-2xs backdrop-blur-sm"
              >
                {att.kind === 'image' ? (
                  <ImageIcon className="h-3.5 w-3.5 text-violet-500" />
                ) : (
                  <FileText className="h-3.5 w-3.5 text-amber-500" />
                )}
                <span className="max-w-[140px] truncate text-[11px] font-medium sm:max-w-[180px]">
                  {att.name}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(att.id)}
                  disabled={isLoading}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Remove attachment"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="relative">
            <input
              ref={attachmentInputRef}
              type="file"
              accept={attachmentAccept}
              multiple
              onChange={onAttachmentChange}
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
            />
            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <div className="rounded-2xl border border-border/80 bg-card/90 p-2 shadow-xs transition-all focus-within:border-foreground/30 focus-within:shadow-sm dark:bg-zinc-900/90">
                      {/* Auto-expanding Multi-line Textarea */}
                      <Textarea
                        {...field}
                        ref={(node) => {
                          field.ref(node);
                          if (composerTextareaRef) {
                            (composerTextareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
                          }
                        }}
                        placeholder={
                          selectedModelOutputsImage
                            ? 'Describe the image you want to generate...'
                            : selectedModelSupportsAttachments
                              ? 'Send a message or attach images / documents...'
                              : 'Send a message...'
                        }
                        disabled={isLoading}
                        rows={1}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void form.handleSubmit(onSubmit)();
                          }
                        }}
                        onChange={(e) => {
                          field.onChange(e);
                          const target = e.target;
                          target.style.height = 'auto';
                          target.style.height = `${Math.min(target.scrollHeight, 180)}px`;
                        }}
                        className="min-h-[44px] max-h-44 w-full resize-none border-0 bg-transparent px-2.5 py-1 text-sm shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0"
                      />

                      {/* Composer Toolbar */}
                      <div className="mt-1 flex items-center justify-between border-t border-border/30 pt-1.5">
                        {/* Left Tools */}
                        <div className="flex items-center gap-1">
                          {/* Attachment Button */}
                          <button
                            type="button"
                            onClick={() => attachmentInputRef.current?.click()}
                            disabled={
                              isLoading ||
                              !selectedModelSupportsAttachments ||
                              !openRouterApiKey.trim()
                            }
                            className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
                            title={
                              selectedModelSupportsAttachments
                                ? 'Attach image or PDF'
                                : 'Model does not support attachments'
                            }
                          >
                            {selectedModelSupportsImageInput ? (
                              <ImageIcon className="h-3.5 w-3.5" />
                            ) : (
                              <Paperclip className="h-3.5 w-3.5" />
                            )}
                            <span className="hidden text-[11px] sm:inline">Attach</span>
                          </button>

                          {/* Web Search Quick Toggle */}
                          <button
                            type="button"
                            onClick={onToggleWebSearch}
                            className={cn(
                              'inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs transition-colors',
                              webSearchEnabled
                                ? 'bg-foreground text-background'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                            )}
                            title="Toggle Web Search tool"
                          >
                            <Globe className="h-3.5 w-3.5" />
                            <span className="text-[11px]">Search</span>
                          </button>
                        </div>

                        {/* Right: Reasoning Effort & Submit / Stop */}
                        <div className="flex items-center gap-1.5">
                          {selectedModelSupportsReasoningEffort && reasoningEffortOptions.length > 0 ? (
                            <Select
                              value={effectiveReasoningEffort}
                              onValueChange={(val) => onSelectReasoningEffort(val as ReasoningEffort)}
                              disabled={isLoading}
                            >
                              <SelectTrigger
                                className="h-7 w-auto gap-1 rounded-lg border border-border/60 bg-muted/30 px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted hover:text-foreground focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-40 [&>svg:last-child]:h-3 [&>svg:last-child]:w-3 [&>svg:last-child]:opacity-50"
                                title="Reasoning effort"
                                aria-label={`Reasoning effort: ${formatEffortLabel(effectiveReasoningEffort)}`}
                              >
                                <Brain className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="text-[11px] font-medium">
                                  {formatEffortLabel(effectiveReasoningEffort)}
                                </span>
                              </SelectTrigger>
                              <SelectContent align="end" className="min-w-[140px] rounded-xl text-xs">
                                {reasoningEffortOptions.map((effort) => (
                                  <SelectItem key={effort} value={effort} className="text-xs">
                                    <span className="flex w-full items-center justify-between gap-3">
                                      <span>{formatEffortLabel(effort)}</span>
                                      {effort === modelDefaultEffort ? (
                                        <span className="text-[10px] text-muted-foreground">
                                          (Default)
                                        </span>
                                      ) : null}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : null}

                          {isLoading ? (
                            <button
                              type="button"
                              onClick={onStop}
                              className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90"
                              aria-label="Stop generation"
                            >
                              <Square className="h-3 w-3 fill-current" />
                            </button>
                          ) : (
                            <button
                              type="submit"
                              disabled={
                                (!field.value.trim() && pendingAttachments.length === 0) || isLoading
                              }
                              className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-20"
                              aria-label="Send prompt"
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </FormControl>
                </FormItem>
              )}
            />
          </form>
        </Form>
      </div>
    </footer>
  );
}
