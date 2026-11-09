'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import hljs from 'highlight.js';

import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Brain,
  Check,
  ChevronDown,
  Coins,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Globe,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Square,
  Wallet,
  X,
  PanelLeft,
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { ChatSidebar } from '@/components/chat-sidebar';
import { ThinkingAccordion } from '@/components/thinking-accordion';
import { SearchChatsDialog } from '@/components/search-chats-dialog';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  fetchOpenRouterKeyInfo,
  OpenRouterKeyInfo,
} from '@/lib/openrouter-key';
import {
  Attachment,
  ChatSession,
  Message,
  MessageUsage,
  ReasoningEffort,
  generateChatTitle,
  generateSessionId,
  getAllSessions,
  saveSession,
  deleteSession,
  clearAllSessions,
  ACTIVE_SESSION_STORAGE_KEY,
  SIDEBAR_OPEN_STORAGE_KEY,
} from '@/lib/chat-sessions';

type OpenRouterModel = {
  id: string;
  name: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  reasoning?: {
    supported_efforts?: ReasoningEffort[] | null;
    default_effort?: ReasoningEffort;
    default_enabled?: boolean;
    mandatory?: boolean;
  };
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
};

const REASONING_EFFORTS: ReasoningEffort[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

const formSchema = z.object({
  message: z.string(),
});

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const SUPPORTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

const SUGGESTED_PROMPTS = [
  {
    title: 'Explain a complex concept',
    prompt: 'Explain quantum computing simply with a real-world analogy.',
  },
  {
    title: 'Write clean code',
    prompt: 'Write a TypeScript custom React hook for debouncing input with cleanup.',
  },
  {
    title: 'System architecture',
    prompt: 'Compare SQL vs NoSQL: tradeoffs in latency, consistency, and scalability.',
  },
];

function isImageAttachment(attachment: Attachment) {
  return attachment.kind === 'image';
}

function toOpenRouterMessage(message: Message) {
  if (!message.attachments?.length) {
    return { role: message.role, content: message.content };
  }

  return {
    role: message.role,
    content: [
      {
        type: 'text',
        text: message.content || 'Please analyze the attached file(s).',
      },
      ...message.attachments.map((attachment) =>
        isImageAttachment(attachment)
          ? {
              type: 'image_url',
              image_url: { url: attachment.dataUrl },
            }
          : {
              type: 'file',
              file: {
                filename: attachment.name,
                file_data: attachment.dataUrl,
              },
            }
      ),
    ],
  };
}

const STORAGE_KEYS = {
  openRouterApiKey: 'prince-chat-openrouter-api-key',
  openRouterModel: 'prince-chat-openrouter-model',
  webSearchEnabled: 'prince-chat-web-search-enabled',
  reasoningEffort: 'prince-chat-reasoning-effort',
  systemPrompt: 'prince-chat-system-prompt',
  activeSessionId: ACTIVE_SESSION_STORAGE_KEY,
  sidebarOpen: SIDEBAR_OPEN_STORAGE_KEY,
};

function formatPricePerMillion(price?: string) {
  const pricePerToken = Number(price);

  if (!Number.isFinite(pricePerToken)) {
    return null;
  }

  const pricePerMillion = pricePerToken * 1_000_000;
  const formattedPrice = pricePerMillion.toLocaleString(undefined, {
    maximumFractionDigits: pricePerMillion >= 1 ? 2 : 4,
  });

  return `$${formattedPrice}/M`;
}

function toFiniteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getMessageUsage(
  usage: unknown,
  pricing?: OpenRouterModel['pricing']
): MessageUsage | null {
  const rawUsage = usage as {
    prompt_tokens?: unknown;
    input_tokens?: unknown;
    completion_tokens?: unknown;
    output_tokens?: unknown;
    cost?: unknown;
  };
  const inputTokens = toFiniteNumber(rawUsage?.prompt_tokens ?? rawUsage?.input_tokens);
  const outputTokens = toFiniteNumber(
    rawUsage?.completion_tokens ?? rawUsage?.output_tokens
  );

  if (inputTokens === null || outputTokens === null) {
    return null;
  }

  const reportedCost = toFiniteNumber(rawUsage?.cost);
  const inputPrice = toFiniteNumber(pricing?.prompt);
  const outputPrice = toFiniteNumber(pricing?.completion);
  const estimatedCost =
    reportedCost ??
    (inputPrice !== null && outputPrice !== null
      ? inputTokens * inputPrice + outputTokens * outputPrice
      : null);

  return { inputTokens, outputTokens, estimatedCost };
}

function formatTokenCount(tokens: number) {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: tokens >= 1_000 ? 1 : 0,
  }).format(tokens);
}

function formatEstimatedCost(cost: number) {
  const maximumFractionDigits =
    cost >= 1 ? 2 : cost >= 0.01 ? 3 : cost >= 0.0001 ? 4 : 6;

  return `$${cost.toLocaleString(undefined, { maximumFractionDigits })}`;
}

function parseOpenRouterChunk(
  chunk: string,
  appendAssistantText: (text: string) => void,
  updateAssistantUsage: (usage: unknown) => void,
  appendAssistantReasoning?: (reasoning: string) => void
) {
  const events = chunk.split(/\r?\n\r?\n/);
  const remainingChunk = events.pop() ?? '';

  for (const event of events) {
    const trimmedEvent = event.trim();
    if (!trimmedEvent) {
      continue;
    }

    const dataLines = trimmedEvent
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice(6).trim());

    for (const dataLine of dataLines) {
      if (!dataLine || dataLine === '[DONE]') {
        continue;
      }

      try {
        const parsed = JSON.parse(dataLine);
        const delta = parsed.choices?.[0]?.delta;
        const reasoning = delta?.reasoning || delta?.reasoning_content;
        const content = delta?.content;

        if (reasoning && appendAssistantReasoning) {
          appendAssistantReasoning(reasoning);
        }

        if (content) {
          appendAssistantText(content);
        }

        if (parsed.usage) {
          updateAssistantUsage(parsed.usage);
        }

        if (parsed.error?.message) {
          throw new Error(parsed.error.message);
        }
      } catch (error) {
        console.error('Error parsing OpenRouter streaming data:', error);
      }
    }
  }

  return remainingChunk;
}

function parseContentAndThinking(message: Message): {
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

function CodeSnippet({
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
      return hljs.highlightAuto(textContent).value;
    } catch {
      return '';
    }
  }, [textContent, language]);

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border/80 bg-zinc-950 text-zinc-100 dark:border-zinc-800 shadow-xs">
      <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/90 px-3.5 py-1.5 text-xs text-zinc-400">
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

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => generateSessionId());
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const [openRouterKeyInfo, setOpenRouterKeyInfo] = useState<OpenRouterKeyInfo | null>(null);
  const [isLoadingKeyInfo, setIsLoadingKeyInfo] = useState(false);
  const reasoningStartRef = useRef<number | null>(null);
  const [openRouterModels, setOpenRouterModels] = useState<OpenRouterModel[]>([]);
  const [selectedOpenRouterModel, setSelectedOpenRouterModel] = useState<string>('');
  const [openRouterApiKey, setOpenRouterApiKey] = useState('');
  const [openRouterModelSearch, setOpenRouterModelSearch] = useState('');
  const [modelCategory, setModelCategory] = useState<'all' | 'vision' | 'image' | 'file'>('all');
  const [isOpenRouterDialogOpen, setIsOpenRouterDialogOpen] = useState(false);
  const [isSearchDialogOpen, setIsSearchDialogOpen] = useState(false);
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [isRetryModelPickerOpen, setIsRetryModelPickerOpen] = useState(false);
  const [retryTargetIndex, setRetryTargetIndex] = useState<number | null>(null);
  const [retryModelSearch, setRetryModelSearch] = useState('');
  const [isFetchingOpenRouterModels, setIsFetchingOpenRouterModels] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | ''>('');
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editingMessageContent, setEditingMessageContent] = useState('');
  const { toast } = useToast();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      message: '',
    },
  });

  const prevIsLoading = useRef(false);

  const selectedModel = selectedOpenRouterModel;
  const selectedModelMetadata = openRouterModels.find(
    (model) => model.id === selectedModel
  );
  const selectedModelOutputsImage =
    selectedModelMetadata?.architecture?.output_modalities?.includes('image') ??
    false;
  const selectedModelSupportsImageInput =
    selectedModelMetadata?.architecture?.input_modalities?.includes('image') ??
    false;
  const selectedModelSupportsFileInput =
    selectedModelMetadata?.architecture?.input_modalities?.includes('file') ??
    false;
  const selectedModelSupportsAttachments =
    selectedModelSupportsImageInput || selectedModelSupportsFileInput;
  const attachmentAccept = [
    selectedModelSupportsImageInput
      ? 'image/png,image/jpeg,image/webp,image/gif'
      : '',
    selectedModelSupportsFileInput ? 'application/pdf' : '',
  ]
    .filter(Boolean)
    .join(',');
  const selectedModelReasoning = selectedModelMetadata?.reasoning;
  const selectedModelSupportsReasoningEffort =
    !selectedModelMetadata ||
    (Boolean(selectedModelReasoning) &&
      (selectedModelReasoning?.supported_efforts === null ||
        Boolean(selectedModelReasoning?.supported_efforts?.length)));
  const reasoningEffortOptions =
    selectedModelReasoning?.supported_efforts?.length
      ? selectedModelReasoning.supported_efforts
      : REASONING_EFFORTS;
  const selectedReasoningEffortIsAvailable =
    !reasoningEffort ||
    selectedModelReasoning?.supported_efforts === null ||
    !selectedModelReasoning?.supported_efforts?.length ||
    selectedModelReasoning.supported_efforts.includes(reasoningEffort);

  const filteredOpenRouterModels = openRouterModels.filter((model) => {
    const inputModalities = model.architecture?.input_modalities ?? [];
    const outputModalities = model.architecture?.output_modalities ?? [];

    if (modelCategory === 'vision' && !inputModalities.includes('image')) return false;
    if (modelCategory === 'image' && !outputModalities.includes('image')) return false;
    if (modelCategory === 'file' && !inputModalities.includes('file')) return false;

    const query = openRouterModelSearch.trim().toLowerCase();
    if (!query) {
      return true;
    }

    const searchableModelDetails = [
      model.id,
      model.name,
      ...inputModalities,
      ...outputModalities,
      ...(inputModalities.includes('image') ? ['vision'] : []),
      ...(outputModalities.includes('image') ? ['image generation'] : []),
    ]
      .join(' ')
      .toLowerCase();

    return searchableModelDetails.includes(query);
  });

  const retryTargetMessage =
    retryTargetIndex === null ? undefined : messages[retryTargetIndex];
  const retryPromptMessage =
    retryTargetIndex === null
      ? undefined
      : [...messages.slice(0, retryTargetIndex)]
          .reverse()
          .find((message) => message.role === 'user');
  const retryModels = openRouterModels.filter((model) => {
    const query = retryModelSearch.trim().toLowerCase();
    const inputModalities = model.architecture?.input_modalities ?? [];
    const outputModalities = model.architecture?.output_modalities ?? [];
    const supportsPromptAttachments =
      !retryPromptMessage?.attachments?.some(
        (attachment) =>
          (attachment.kind === 'image' && !inputModalities.includes('image')) ||
          (attachment.kind === 'file' && !inputModalities.includes('file'))
      );
    const supportsTextOutput =
      outputModalities.length === 0 || outputModalities.includes('text');
    const searchableModelDetails = [model.id, model.name, ...inputModalities, ...outputModalities]
      .join(' ')
      .toLowerCase();

    return (
      model.id !== retryTargetMessage?.modelId &&
      supportsPromptAttachments &&
      supportsTextOutput &&
      (!query || searchableModelDetails.includes(query))
    );
  });

  const appendAssistantReasoning = (reasoningChunk: string) => {
    if (!reasoningStartRef.current) {
      reasoningStartRef.current = Date.now();
    }

    setMessages((prev) => {
      const updatedMessages = [...prev];
      const lastMessage = updatedMessages[updatedMessages.length - 1];

      if (lastMessage && lastMessage.role === 'assistant') {
        updatedMessages[updatedMessages.length - 1] = {
          ...lastMessage,
          reasoning: (lastMessage.reasoning || '') + reasoningChunk,
        };
      }

      return updatedMessages;
    });
  };

  const appendAssistantText = (text: string) => {
    let finalizedReasoningTime: number | undefined;
    if (reasoningStartRef.current) {
      finalizedReasoningTime = Date.now() - reasoningStartRef.current;
      reasoningStartRef.current = null;
    }

    setMessages((prev) => {
      const updatedMessages = [...prev];
      const lastMessage = updatedMessages[updatedMessages.length - 1];

      if (lastMessage && lastMessage.role === 'assistant') {
        updatedMessages[updatedMessages.length - 1] = {
          ...lastMessage,
          content: lastMessage.content + text,
          reasoningTimeMs: lastMessage.reasoningTimeMs ?? finalizedReasoningTime,
        };
      }

      return updatedMessages;
    });
  };

  const loadKeyInfo = async (key: string) => {
    if (!key.trim()) {
      setOpenRouterKeyInfo(null);
      return;
    }
    setIsLoadingKeyInfo(true);
    try {
      const info = await fetchOpenRouterKeyInfo(key);
      setOpenRouterKeyInfo(info);
    } catch (err) {
      console.warn('Could not load OpenRouter key info', err);
    } finally {
      setIsLoadingKeyInfo(false);
    }
  };

  const updateAssistantUsage = (
    usage: unknown,
    pricing?: OpenRouterModel['pricing']
  ) => {
    const messageUsage = getMessageUsage(usage, pricing);
    if (!messageUsage) {
      return;
    }

    setMessages((prev) => {
      const updatedMessages = [...prev];
      const lastMessage = updatedMessages[updatedMessages.length - 1];

      if (lastMessage?.role === 'assistant') {
        updatedMessages[updatedMessages.length - 1] = {
          ...lastMessage,
          usage: messageUsage,
        };
      }

      return updatedMessages;
    });
  };

  const fetchOpenRouterModels = async (apiKey: string) => {
    if (!apiKey.trim()) {
      setOpenRouterModels([]);
      return;
    }

    setIsFetchingOpenRouterModels(true);

    try {
      const response = await fetch(
        '/api/openrouter/api/v1/models?output_modalities=all&sort=most-popular',
        {
          headers: {
            'x-openrouter-api-key': apiKey.trim(),
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch models from OpenRouter.');
      }

      const data = await response.json();
      const fetchedModels = Array.isArray(data.data) ? data.data : [];
      setOpenRouterModels(fetchedModels);

      setSelectedOpenRouterModel((currentModel) => {
        if (
          currentModel &&
          fetchedModels.some((model: OpenRouterModel) => model.id === currentModel)
        ) {
          return currentModel;
        }

        const storedModel = localStorage.getItem(STORAGE_KEYS.openRouterModel);
        if (
          storedModel &&
          fetchedModels.some((model: OpenRouterModel) => model.id === storedModel)
        ) {
          return storedModel;
        }

        return currentModel || storedModel || '';
      });
    } catch (error) {
      console.error(error);
      toast({
        variant: 'destructive',
        title: 'Failed to fetch OpenRouter models.',
        description: 'Check that your OpenRouter API key is valid and try again.',
      });
    } finally {
      setIsFetchingOpenRouterModels(false);
    }
  };

  useEffect(() => {
    if (prevIsLoading.current && !isLoading) {
      composerTextareaRef.current?.focus();
    }
    prevIsLoading.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    let isMounted = true;

    const storedOpenRouterApiKey =
      localStorage.getItem(STORAGE_KEYS.openRouterApiKey) ?? '';
    const storedOpenRouterModel =
      localStorage.getItem(STORAGE_KEYS.openRouterModel) ?? '';
    const storedWebSearchEnabled = localStorage.getItem(
      STORAGE_KEYS.webSearchEnabled
    );
    const storedReasoningEffort = localStorage.getItem(
      STORAGE_KEYS.reasoningEffort
    );
    const storedSystemPrompt = localStorage.getItem(
      STORAGE_KEYS.systemPrompt
    );

    setOpenRouterApiKey(storedOpenRouterApiKey);
    setSelectedOpenRouterModel(storedOpenRouterModel);
    setWebSearchEnabled(storedWebSearchEnabled === 'true');
    setReasoningEffort(
      REASONING_EFFORTS.includes(storedReasoningEffort as ReasoningEffort)
        ? (storedReasoningEffort as ReasoningEffort)
        : ''
    );
    setSystemPrompt(storedSystemPrompt ?? '');

    if (storedOpenRouterApiKey) {
      void fetchOpenRouterModels(storedOpenRouterApiKey);
      void loadKeyInfo(storedOpenRouterApiKey);
    }

    const initSessions = async () => {
      try {
        const storedSessions = await getAllSessions();
        if (!isMounted) return;

        setSessions(storedSessions);

        const savedActiveId = localStorage.getItem(STORAGE_KEYS.activeSessionId);
        const targetSession = storedSessions.find((s) => s.id === savedActiveId);

        if (targetSession) {
          setActiveSessionId(targetSession.id);
          setMessages(targetSession.messages);
          if (targetSession.modelId) {
            setSelectedOpenRouterModel(targetSession.modelId);
          }
          if (targetSession.systemPrompt !== undefined) {
            setSystemPrompt(targetSession.systemPrompt);
          }
          if (targetSession.webSearchEnabled !== undefined) {
            setWebSearchEnabled(targetSession.webSearchEnabled);
          }
          if (targetSession.reasoningEffort !== undefined) {
            setReasoningEffort(targetSession.reasoningEffort);
          }
        } else if (storedSessions.length > 0) {
          const latest = storedSessions[0];
          setActiveSessionId(latest.id);
          setMessages(latest.messages);
          if (latest.modelId) {
            setSelectedOpenRouterModel(latest.modelId);
          }
          if (latest.systemPrompt !== undefined) {
            setSystemPrompt(latest.systemPrompt);
          }
          if (latest.webSearchEnabled !== undefined) {
            setWebSearchEnabled(latest.webSearchEnabled);
          }
          if (latest.reasoningEffort !== undefined) {
            setReasoningEffort(latest.reasoningEffort);
          }
        }
      } catch (err) {
        console.error('Failed to initialize sessions', err);
      }
    };

    void initSessions();

    const storedSidebarOpen = localStorage.getItem(STORAGE_KEYS.sidebarOpen);
    if (storedSidebarOpen !== null) {
      setIsSidebarOpen(storedSidebarOpen === 'true');
    }

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (activeSessionId) {
      localStorage.setItem(STORAGE_KEYS.activeSessionId, activeSessionId);
    }
  }, [activeSessionId]);

  const handleToggleSidebar = useCallback(() => {
    if (isMobile) {
      setIsMobileSidebarOpen((prev) => !prev);
    } else {
      setIsSidebarOpen((prev) => {
        const next = !prev;
        localStorage.setItem(STORAGE_KEYS.sidebarOpen, String(next));
        return next;
      });
    }
  }, [isMobile]);

  const handleNewChat = useCallback(() => {
    if (isLoading) {
      toast({
        title: 'Generation in progress',
        description: 'Please stop generation or wait for it to finish first.',
      });
      return;
    }

    const newId = generateSessionId();
    setActiveSessionId(newId);
    setMessages([]);
    setPendingAttachments([]);
    setEditingMessageIndex(null);
    form.reset();
    if (composerTextareaRef.current) {
      composerTextareaRef.current.style.height = 'auto';
    }
    if (isMobile) {
      setIsMobileSidebarOpen(false);
    }
  }, [isLoading, isMobile, toast, form]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        handleToggleSidebar();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchDialogOpen((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        handleNewChat();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToggleSidebar, handleNewChat]);

  const persistCurrentSession = useCallback(
    async (
      updatedMessages: Message[],
      overrideTitle?: string,
      targetId?: string
    ) => {
      const sessionId = targetId || activeSessionId;
      if (!sessionId || updatedMessages.length === 0) {
        return;
      }

      setSessions((prevSessions) => {
        const existing = prevSessions.find((s) => s.id === sessionId);
        const firstUserMsg = updatedMessages.find((m) => m.role === 'user');
        const defaultTitle = firstUserMsg
          ? generateChatTitle(
              firstUserMsg.content ||
                firstUserMsg.attachments?.[0]?.name ||
                'New Chat'
            )
          : 'New Chat';
        const title = overrideTitle || existing?.title || defaultTitle;

        const updatedSession: ChatSession = {
          id: sessionId,
          title,
          createdAt: existing?.createdAt || Date.now(),
          updatedAt: Date.now(),
          messages: updatedMessages,
          modelId: selectedModel,
          systemPrompt,
          webSearchEnabled,
          reasoningEffort,
        };

        const filtered = prevSessions.filter((s) => s.id !== sessionId);
        const nextSessions = [updatedSession, ...filtered];
        nextSessions.sort((a, b) => b.updatedAt - a.updatedAt);

        void saveSession(updatedSession);

        return nextSessions;
      });
    },
    [activeSessionId, selectedModel, systemPrompt, webSearchEnabled, reasoningEffort]
  );

  const handleSelectSession = (id: string) => {
    if (id === activeSessionId) {
      if (isMobile) setIsMobileSidebarOpen(false);
      return;
    }

    if (isLoading) {
      toast({
        title: 'Generation in progress',
        description: 'Please stop generation or wait for it to finish before switching chats.',
      });
      return;
    }

    const target = sessions.find((s) => s.id === id);
    if (!target) return;

    setActiveSessionId(target.id);
    setMessages(target.messages);

    if (target.modelId) {
      setSelectedOpenRouterModel(target.modelId);
    }
    if (target.systemPrompt !== undefined) {
      setSystemPrompt(target.systemPrompt);
    }
    if (target.webSearchEnabled !== undefined) {
      setWebSearchEnabled(target.webSearchEnabled);
    }
    if (target.reasoningEffort !== undefined) {
      setReasoningEffort(target.reasoningEffort);
    }

    setPendingAttachments([]);
    setEditingMessageIndex(null);
    form.reset();
    if (composerTextareaRef.current) {
      composerTextareaRef.current.style.height = 'auto';
    }

    if (isMobile) {
      setIsMobileSidebarOpen(false);
    }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));

      if (activeSessionId === id) {
        const remaining = sessions.filter((s) => s.id !== id);
        if (remaining.length > 0) {
          const nextSession = remaining[0];
          setActiveSessionId(nextSession.id);
          setMessages(nextSession.messages);
          if (nextSession.modelId) {
            setSelectedOpenRouterModel(nextSession.modelId);
          }
        } else {
          handleNewChat();
        }
      }

      toast({
        title: 'Conversation deleted',
        duration: 2000,
      });
    } catch (err) {
      console.error('Failed to delete session', err);
      toast({
        variant: 'destructive',
        title: 'Failed to delete conversation',
      });
    }
  };

  const handleRenameSession = (id: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;

    setSessions((prev) => {
      const target = prev.find((s) => s.id === id);
      if (!target) return prev;
      const updated = { ...target, title: trimmed, updatedAt: Date.now() };
      void saveSession(updated);
      return prev.map((s) => (s.id === id ? updated : s));
    });

    toast({
      title: 'Conversation renamed',
      duration: 2000,
    });
  };

  const handleClearAllSessions = async () => {
    try {
      await clearAllSessions();
      setSessions([]);
      handleNewChat();
      toast({
        title: 'All conversations cleared',
        duration: 2000,
      });
    } catch (err) {
      console.error('Failed to clear sessions', err);
      toast({
        variant: 'destructive',
        title: 'Failed to clear conversations',
      });
    }
  };

  useEffect(() => {
    if (selectedOpenRouterModel) {
      localStorage.setItem(STORAGE_KEYS.openRouterModel, selectedOpenRouterModel);
    }
  }, [selectedOpenRouterModel]);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEYS.webSearchEnabled,
      String(webSearchEnabled)
    );
  }, [webSearchEnabled]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.reasoningEffort, reasoningEffort);
  }, [reasoningEffort]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.systemPrompt, systemPrompt);
  }, [systemPrompt]);

  useEffect(() => {
    const unsupportedAttachments = pendingAttachments.filter(
      (attachment) =>
        (attachment.kind === 'image' && !selectedModelSupportsImageInput) ||
        (attachment.kind === 'file' && !selectedModelSupportsFileInput)
    );

    if (unsupportedAttachments.length) {
      setPendingAttachments([]);
      toast({
        title: 'Attachments removed',
        description: 'The newly selected model does not support those attachment types.',
        duration: 3000,
      });
    }
  }, [
    pendingAttachments,
    selectedModelSupportsFileInput,
    selectedModelSupportsImageInput,
    toast,
  ]);

  useEffect(() => {
    if (!messages.length) return;

    const viewport = scrollAreaRef.current?.querySelector<HTMLDivElement>(
      '[data-radix-scroll-area-viewport]'
    );

    viewport?.scrollTo({
      top: viewport.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages]);

  // Scroll-to-bottom detection
  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLDivElement>(
      '[data-radix-scroll-area-viewport]'
    );
    if (!viewport) return;

    const handleScroll = () => {
      const distanceFromBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      setShowScrollToBottom(distanceFromBottom > 140);
    };

    viewport.addEventListener('scroll', handleScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToBottom = useCallback(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLDivElement>(
      '[data-radix-scroll-area-viewport]'
    );
    viewport?.scrollTo({
      top: viewport.scrollHeight,
      behavior: 'smooth',
    });
  }, []);

  const removePendingAttachment = (id: string) => {
    setPendingAttachments((current) =>
      current.filter((attachment) => attachment.id !== id)
    );
  };

  const handleAttachmentChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';

    if (!files.length) {
      return;
    }

    const availableSlots = MAX_ATTACHMENTS - pendingAttachments.length;
    if (availableSlots <= 0) {
      toast({
        variant: 'destructive',
        title: `You can attach up to ${MAX_ATTACHMENTS} files.`,
      });
      return;
    }

    const acceptedFiles = files.slice(0, availableSlots).filter((file) => {
      const isImage = SUPPORTED_IMAGE_TYPES.has(file.type);
      const isPdf = file.type === 'application/pdf';
      const supportedByModel =
        (isImage && selectedModelSupportsImageInput) ||
        (isPdf && selectedModelSupportsFileInput);

      if (!isImage && !isPdf) {
        toast({
          variant: 'destructive',
          title: 'Unsupported attachment',
          description: `${file.name} is not a supported image or PDF.`,
        });
        return false;
      }

      if (!supportedByModel) {
        toast({
          variant: 'destructive',
          title: 'Model does not support this attachment',
          description: `${selectedModelMetadata?.name || 'This model'} cannot receive ${
            isImage ? 'images' : 'PDF documents'
          }.`,
        });
        return false;
      }

      if (file.size > MAX_ATTACHMENT_SIZE) {
        toast({
          variant: 'destructive',
          title: 'Attachment is too large',
          description: `${file.name} must be 10 MB or smaller.`,
        });
        return false;
      }

      return true;
    });

    const attachments = await Promise.all(
      acceptedFiles.map(
        (file) =>
          new Promise<Attachment>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
                name: file.name,
                mediaType: file.type,
                dataUrl: String(reader.result),
                kind: SUPPORTED_IMAGE_TYPES.has(file.type) ? 'image' : 'file',
              });
            reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
            reader.readAsDataURL(file);
          })
      )
    );

    setPendingAttachments((current) => [...current, ...attachments]);
  };

  const handleStopGenerating = () => {
    abortControllerRef.current?.abort();
    setMessages((latest) => {
      void persistCurrentSession(latest);
      return latest;
    });
  };

  const handleSaveOpenRouterSettings = async () => {
    const sanitizedApiKey = openRouterApiKey.trim();

    localStorage.setItem(STORAGE_KEYS.openRouterApiKey, sanitizedApiKey);
    setIsOpenRouterDialogOpen(false);

    if (sanitizedApiKey) {
      await fetchOpenRouterModels(sanitizedApiKey);
      void loadKeyInfo(sanitizedApiKey);
    } else {
      setOpenRouterModels([]);
      setOpenRouterKeyInfo(null);
    }

    toast({
      title: 'OpenRouter API key saved',
      description: 'Your key is stored locally in this browser.',
      duration: 2000,
    });
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (isLoading) {
      return;
    }

    const hasApiKey = Boolean(openRouterApiKey.trim());
    if (!hasApiKey || !selectedModel) {
      toast({
        title: 'Finish setup first',
        description:
          !hasApiKey && !selectedModel
            ? 'Add your OpenRouter API key and select a model before sending a message.'
            : !hasApiKey
              ? 'Add your OpenRouter API key before sending a message.'
              : 'Select an OpenRouter model before sending a message.',
      });

      if (!hasApiKey) {
        setIsOpenRouterDialogOpen(true);
      } else {
        setIsModelPickerOpen(true);
      }

      return;
    }

    const userInput = values.message.trim();
    if (!userInput && pendingAttachments.length === 0) {
      return;
    }

    const hasAttachments = pendingAttachments.length > 0;

    const newMessages: Message[] = [
      ...messages,
      { role: 'user', content: userInput, attachments: pendingAttachments },
    ];

    setMessages(newMessages);
    void persistCurrentSession(newMessages);
    setPendingAttachments([]);
    form.reset();
    if (composerTextareaRef.current) {
      composerTextareaRef.current.style.height = 'auto';
    }
    setIsLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      if (selectedModelOutputsImage && !hasAttachments) {
        const response = await fetch('/api/openrouter/api/v1/images', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-openrouter-api-key': openRouterApiKey.trim(),
          },
          body: JSON.stringify({
            model: selectedModel,
            prompt: userInput,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error('The image generation request failed.');
        }

        const data = await response.json();
        const images = Array.isArray(data.data)
          ? data.data
              .filter((item: { b64_json?: string }) => Boolean(item?.b64_json))
              .map(
                (item: { b64_json: string; media_type?: string }) => ({
                  url: `data:${item.media_type || 'image/png'};base64,${item.b64_json}`,
                  mediaType: item.media_type || 'image/png',
                })
              )
          : [];

        if (images.length === 0) {
          throw new Error('The image generation response did not contain any images.');
        }

        const imageAssistantMsg: Message = {
          role: 'assistant',
          content: `Generated ${images.length} image${images.length > 1 ? 's' : ''}.`,
          images,
          modelId: selectedModel,
        };
        const finalImageMessages: Message[] = [...newMessages, imageAssistantMsg];
        setMessages(finalImageMessages);
        void persistCurrentSession(finalImageMessages);
      } else {
        const requestPricing = selectedModelMetadata?.pricing;
        const response = await fetch('/api/openrouter/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-openrouter-api-key': openRouterApiKey.trim(),
          },
          body: JSON.stringify({
            model: selectedModel,
            messages: [
              ...(systemPrompt.trim()
                ? [{ role: 'system', content: systemPrompt.trim() }]
                : []),
              ...newMessages.map(toOpenRouterMessage),
            ],
            stream: true,
            ...(webSearchEnabled
              ? { tools: [{ type: 'openrouter:web_search' }] }
              : {}),
            ...(reasoningEffort &&
            selectedModelSupportsReasoningEffort &&
            selectedReasoningEffortIsAvailable
              ? { reasoning: { effort: reasoningEffort } }
              : {}),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error('The request failed.');
        }

        if (!response.body) {
          throw new Error('The response body is empty.');
        }

        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: '', modelId: selectedModel },
        ]);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let bufferedChunk = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          bufferedChunk = parseOpenRouterChunk(
            bufferedChunk + decoder.decode(value, { stream: true }),
            appendAssistantText,
            (usage) => updateAssistantUsage(usage, requestPricing),
            appendAssistantReasoning
          );
        }

        const finalChunk = bufferedChunk + decoder.decode();
        if (finalChunk.trim()) {
          parseOpenRouterChunk(
            `${finalChunk}\n\n`,
            appendAssistantText,
            (usage) => updateAssistantUsage(usage, requestPricing),
            appendAssistantReasoning
          );
        }

        if (reasoningStartRef.current) {
          const duration = Date.now() - reasoningStartRef.current;
          reasoningStartRef.current = null;
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === 'assistant') {
              updated[updated.length - 1] = {
                ...last,
                reasoningTimeMs: last.reasoningTimeMs ?? duration,
              };
            }
            return updated;
          });
        }

        setMessages((latest) => {
          void persistCurrentSession(latest);
          return latest;
        });
      }
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.log('Generation stopped by user.');
      } else {
        setMessages((prev) => {
          const next =
            prev[prev.length - 1]?.role === 'assistant' ? prev.slice(0, -1) : prev;
          void persistCurrentSession(next);
          return next;
        });
        toast({
          variant: 'destructive',
          title: 'An error occurred.',
          description: 'Failed to get a response from OpenRouter. Check your API key and model.',
        });
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      if (reasoningStartRef.current) {
        reasoningStartRef.current = null;
      }
      void loadKeyInfo(openRouterApiKey);
    }
  };

  const handleOpenRetryPicker = (messageIndex: number) => {
    if (isLoading) {
      return;
    }

    const promptMessage = [...messages.slice(0, messageIndex)]
      .reverse()
      .find((message) => message.role === 'user');

    if (!promptMessage) {
      toast({
        variant: 'destructive',
        title: 'Unable to retry this response.',
        description: 'The original prompt is no longer available.',
      });
      return;
    }

    setRetryTargetIndex(messageIndex);
    setRetryModelSearch('');
    setIsRetryModelPickerOpen(true);
  };

  const handleRetryWithModel = async (modelId: string) => {
    if (isLoading || retryTargetIndex === null || !openRouterApiKey.trim()) {
      return;
    }

    const retryMessages = messages.slice(0, retryTargetIndex);
    const retryModelMetadata = openRouterModels.find((model) => model.id === modelId);
    const retryModelReasoning = retryModelMetadata?.reasoning;
    const retryModelSupportsReasoningEffort =
      Boolean(retryModelReasoning) &&
      (retryModelReasoning?.supported_efforts === null ||
        Boolean(retryModelReasoning?.supported_efforts?.length));
    const retryReasoningEffortIsAvailable =
      !reasoningEffort ||
      retryModelReasoning?.supported_efforts === null ||
      !retryModelReasoning?.supported_efforts?.length ||
      retryModelReasoning.supported_efforts.includes(reasoningEffort);

    setIsRetryModelPickerOpen(false);
    setRetryTargetIndex(null);
    setIsLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/openrouter/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-openrouter-api-key': openRouterApiKey.trim(),
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            ...(systemPrompt.trim()
              ? [{ role: 'system', content: systemPrompt.trim() }]
              : []),
            ...retryMessages.map(toOpenRouterMessage),
          ],
          stream: true,
          ...(webSearchEnabled
            ? { tools: [{ type: 'openrouter:web_search' }] }
            : {}),
          ...(reasoningEffort &&
          retryModelSupportsReasoningEffort &&
          retryReasoningEffortIsAvailable
            ? { reasoning: { effort: reasoningEffort } }
            : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error('The retry request failed.');
      }

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '', modelId },
      ]);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let bufferedChunk = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        bufferedChunk = parseOpenRouterChunk(
          bufferedChunk + decoder.decode(value, { stream: true }),
          appendAssistantText,
          (usage) => updateAssistantUsage(usage, retryModelMetadata?.pricing),
          appendAssistantReasoning
        );
      }

      const finalChunk = bufferedChunk + decoder.decode();
      if (finalChunk.trim()) {
        parseOpenRouterChunk(
          `${finalChunk}\n\n`,
          appendAssistantText,
          (usage) => updateAssistantUsage(usage, retryModelMetadata?.pricing),
          appendAssistantReasoning
        );
      }

      if (reasoningStartRef.current) {
        const duration = Date.now() - reasoningStartRef.current;
        reasoningStartRef.current = null;
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant') {
            updated[updated.length - 1] = {
              ...last,
              reasoningTimeMs: last.reasoningTimeMs ?? duration,
            };
          }
          return updated;
        });
      }

      setMessages((latest) => {
        void persistCurrentSession(latest);
        return latest;
      });
    } catch (error: unknown) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setMessages((prev) => {
          const next =
            prev[prev.length - 1]?.role === 'assistant' ? prev.slice(0, -1) : prev;
          void persistCurrentSession(next);
          return next;
        });
        toast({
          variant: 'destructive',
          title: 'Retry failed.',
          description: 'Unable to get a response from the selected model.',
        });
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      if (reasoningStartRef.current) {
        reasoningStartRef.current = null;
      }
      void loadKeyInfo(openRouterApiKey);
    }
  };

  const handleRegenerate = async (messageIndex: number) => {
    if (isLoading || !openRouterApiKey.trim()) return;

    const targetMessage = messages[messageIndex];
    if (!targetMessage || targetMessage.role !== 'assistant') return;

    const modelId = targetMessage.modelId || selectedModel;
    if (!modelId) return;

    const conversationUpToTarget = messages.slice(0, messageIndex);
    const baseMessages = conversationUpToTarget;
    setMessages(baseMessages);
    setIsLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const regenerateModelMetadata = openRouterModels.find((m) => m.id === modelId);
    const regenerateReasoning = regenerateModelMetadata?.reasoning;
    const regenerateSupportsReasoningEffort =
      Boolean(regenerateReasoning) &&
      (regenerateReasoning?.supported_efforts === null ||
        Boolean(regenerateReasoning?.supported_efforts?.length));
    const regenerateReasoningEffortIsAvailable =
      !reasoningEffort ||
      regenerateReasoning?.supported_efforts === null ||
      !regenerateReasoning?.supported_efforts?.length ||
      regenerateReasoning.supported_efforts.includes(reasoningEffort);

    try {
      const response = await fetch('/api/openrouter/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-openrouter-api-key': openRouterApiKey.trim(),
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            ...(systemPrompt.trim()
              ? [{ role: 'system', content: systemPrompt.trim() }]
              : []),
            ...baseMessages.map(toOpenRouterMessage),
          ],
          stream: true,
          ...(webSearchEnabled
            ? { tools: [{ type: 'openrouter:web_search' }] }
            : {}),
          ...(reasoningEffort &&
          regenerateSupportsReasoningEffort &&
          regenerateReasoningEffortIsAvailable
            ? { reasoning: { effort: reasoningEffort } }
            : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error('The regeneration request failed.');
      }

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '', modelId },
      ]);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let bufferedChunk = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        bufferedChunk = parseOpenRouterChunk(
          bufferedChunk + decoder.decode(value, { stream: true }),
          appendAssistantText,
          (usage) => updateAssistantUsage(usage, regenerateModelMetadata?.pricing),
          appendAssistantReasoning
        );
      }

      const finalChunk = bufferedChunk + decoder.decode();
      if (finalChunk.trim()) {
        parseOpenRouterChunk(
          `${finalChunk}\n\n`,
          appendAssistantText,
          (usage) => updateAssistantUsage(usage, regenerateModelMetadata?.pricing),
          appendAssistantReasoning
        );
      }

      if (reasoningStartRef.current) {
        const duration = Date.now() - reasoningStartRef.current;
        reasoningStartRef.current = null;
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant') {
            updated[updated.length - 1] = {
              ...last,
              reasoningTimeMs: last.reasoningTimeMs ?? duration,
            };
          }
          return updated;
        });
      }

      setMessages((latest) => {
        void persistCurrentSession(latest);
        return latest;
      });
    } catch (error: unknown) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setMessages((prev) => {
          const next =
            prev[prev.length - 1]?.role === 'assistant' ? prev.slice(0, -1) : prev;
          void persistCurrentSession(next);
          return next;
        });
        toast({
          variant: 'destructive',
          title: 'Regeneration failed.',
          description: 'Unable to regenerate the response.',
        });
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      if (reasoningStartRef.current) {
        reasoningStartRef.current = null;
      }
      void loadKeyInfo(openRouterApiKey);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'Copied to clipboard',
      description: 'The message has been copied to your clipboard.',
      duration: 2000,
    });
  };

  const handleSelectSuggestedPrompt = (prompt: string) => {
    form.setValue('message', prompt);
    if (composerTextareaRef.current) {
      composerTextareaRef.current.focus();
      composerTextareaRef.current.style.height = 'auto';
      composerTextareaRef.current.style.height = `${composerTextareaRef.current.scrollHeight}px`;
    }
  };

  const handleEditMessage = (index: number) => {
    if (isLoading) return;
    const message = messages[index];
    if (!message || message.role !== 'user') return;
    setEditingMessageIndex(index);
    setEditingMessageContent(message.content);
  };

  const handleCancelEdit = () => {
    setEditingMessageIndex(null);
    setEditingMessageContent('');
  };

  const handleSaveEdit = async () => {
    if (editingMessageIndex === null || isLoading) return;

    const hasApiKey = Boolean(openRouterApiKey.trim());
    if (!hasApiKey || !selectedModel) return;

    const editedContent = editingMessageContent.trim();
    if (!editedContent) return;

    const originalMessage = messages[editingMessageIndex];
    const truncatedMessages: Message[] = messages.slice(0, editingMessageIndex);
    const editedUserMessage: Message = {
      ...originalMessage,
      content: editedContent,
    };
    const newMessages = [...truncatedMessages, editedUserMessage];

    setMessages(newMessages);
    void persistCurrentSession(newMessages);
    setEditingMessageIndex(null);
    setEditingMessageContent('');
    setIsLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const requestPricing = selectedModelMetadata?.pricing;
      const response = await fetch('/api/openrouter/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-openrouter-api-key': openRouterApiKey.trim(),
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            ...(systemPrompt.trim()
              ? [{ role: 'system', content: systemPrompt.trim() }]
              : []),
            ...newMessages.map(toOpenRouterMessage),
          ],
          stream: true,
          ...(webSearchEnabled
            ? { tools: [{ type: 'openrouter:web_search' }] }
            : {}),
          ...(reasoningEffort &&
          selectedModelSupportsReasoningEffort &&
          selectedReasoningEffortIsAvailable
            ? { reasoning: { effort: reasoningEffort } }
            : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error('The request failed.');
      }

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '', modelId: selectedModel },
      ]);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let bufferedChunk = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        bufferedChunk = parseOpenRouterChunk(
          bufferedChunk + decoder.decode(value, { stream: true }),
          appendAssistantText,
          (usage) => updateAssistantUsage(usage, requestPricing),
          appendAssistantReasoning
        );
      }

      const finalChunk = bufferedChunk + decoder.decode();
      if (finalChunk.trim()) {
        parseOpenRouterChunk(
          `${finalChunk}\n\n`,
          appendAssistantText,
          (usage) => updateAssistantUsage(usage, requestPricing),
          appendAssistantReasoning
        );
      }

      if (reasoningStartRef.current) {
        const duration = Date.now() - reasoningStartRef.current;
        reasoningStartRef.current = null;
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant') {
            updated[updated.length - 1] = {
              ...last,
              reasoningTimeMs: last.reasoningTimeMs ?? duration,
            };
          }
          return updated;
        });
      }

      setMessages((latest) => {
        void persistCurrentSession(latest);
        return latest;
      });
    } catch (error: unknown) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setMessages((prev) => {
          const next =
            prev[prev.length - 1]?.role === 'assistant' ? prev.slice(0, -1) : prev;
          void persistCurrentSession(next);
          return next;
        });
        toast({
          variant: 'destructive',
          title: 'An error occurred.',
          description: 'Failed to get a response after editing.',
        });
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      if (reasoningStartRef.current) {
        reasoningStartRef.current = null;
      }
      void loadKeyInfo(openRouterApiKey);
    }
  };

  const handleErrorRetry = async () => {
    if (isLoading || messages.length === 0) return;
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'user') return;

    const hasApiKey = Boolean(openRouterApiKey.trim());
    if (!hasApiKey || !selectedModel) {
      toast({
        title: 'Finish setup first',
        description: !hasApiKey ? 'Add your OpenRouter API key.' : 'Select a model.',
      });
      return;
    }

    setIsLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const requestPricing = selectedModelMetadata?.pricing;
      const response = await fetch('/api/openrouter/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-openrouter-api-key': openRouterApiKey.trim(),
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            ...(systemPrompt.trim()
              ? [{ role: 'system', content: systemPrompt.trim() }]
              : []),
            ...messages.map(toOpenRouterMessage),
          ],
          stream: true,
          ...(webSearchEnabled
            ? { tools: [{ type: 'openrouter:web_search' }] }
            : {}),
          ...(reasoningEffort &&
          selectedModelSupportsReasoningEffort &&
          selectedReasoningEffortIsAvailable
            ? { reasoning: { effort: reasoningEffort } }
            : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error('The request failed.');
      }

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '', modelId: selectedModel },
      ]);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let bufferedChunk = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        bufferedChunk = parseOpenRouterChunk(
          bufferedChunk + decoder.decode(value, { stream: true }),
          appendAssistantText,
          (usage) => updateAssistantUsage(usage, requestPricing),
          appendAssistantReasoning
        );
      }

      const finalChunk = bufferedChunk + decoder.decode();
      if (finalChunk.trim()) {
        parseOpenRouterChunk(
          `${finalChunk}\n\n`,
          appendAssistantText,
          (usage) => updateAssistantUsage(usage, requestPricing),
          appendAssistantReasoning
        );
      }

      if (reasoningStartRef.current) {
        const duration = Date.now() - reasoningStartRef.current;
        reasoningStartRef.current = null;
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant') {
            updated[updated.length - 1] = {
              ...last,
              reasoningTimeMs: last.reasoningTimeMs ?? duration,
            };
          }
          return updated;
        });
      }

      setMessages((latest) => {
        void persistCurrentSession(latest);
        return latest;
      });
    } catch (error: unknown) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setMessages((prev) => {
          const next =
            prev[prev.length - 1]?.role === 'assistant' ? prev.slice(0, -1) : prev;
          void persistCurrentSession(next);
          return next;
        });
        toast({
          variant: 'destructive',
          title: 'Retry failed.',
          description: 'Failed to get a response from OpenRouter.',
        });
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      if (reasoningStartRef.current) {
        reasoningStartRef.current = null;
      }
      void loadKeyInfo(openRouterApiKey);
    }
  };

  const handleExportConversation = () => {
    if (messages.length === 0) {
      toast({
        title: 'Nothing to export',
        description: 'Start a conversation before exporting.',
        duration: 2000,
      });
      return;
    }

    const currentSession = sessions.find((s) => s.id === activeSessionId);
    const sessionTitle = currentSession?.title || 'Prince Chat Export';

    const lines: string[] = [
      `# ${sessionTitle}`,
      '',
      `**Model:** ${selectedModelMetadata?.name || selectedModel || 'Unknown'}`,
      `**Date:** ${new Date().toLocaleString()}`,
      '',
      '---',
      '',
    ];

    for (const message of messages) {
      if (message.role === 'user') {
        lines.push('## 🧑 You', '', message.content, '');
      } else {
        const modelLabel = message.modelId
          ? openRouterModels.find((m) => m.id === message.modelId)?.name || message.modelId
          : 'Assistant';
        lines.push(`## 🤖 ${modelLabel}`, '');
        const { displayReasoning, displayContent } = parseContentAndThinking(message);
        if (displayReasoning) {
          lines.push(
            '> **Thinking Process:**',
            ...displayReasoning.split('\n').map((l) => `> ${l}`),
            ''
          );
        }
        lines.push(displayContent, '');
        if (message.usage) {
          lines.push(
            `> *${message.usage.inputTokens.toLocaleString()} in · ${message.usage.outputTokens.toLocaleString()} out${
              message.usage.estimatedCost !== null
                ? ` · ≈ ${formatEstimatedCost(message.usage.estimatedCost)}`
                : ''
            }*`,
            ''
          );
        }
      }
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const titleSlug = currentSession?.title
      ? currentSession.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32)
      : 'prince-chat';
    link.download = `${titleSlug}-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: 'Conversation exported',
      description: 'Your conversation has been downloaded as Markdown.',
      duration: 2000,
    });
  };

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <ChatSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
        onClearAllSessions={handleClearAllSessions}
        isOpen={isMobile ? isMobileSidebarOpen : isSidebarOpen}
        onToggleOpen={handleToggleSidebar}
        isMobile={isMobile}
        isLoading={isLoading}
      />

      {/* Main Content Area */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top Header */}
        <header className="z-10 flex h-14 shrink-0 items-center justify-between border-b border-border/40 bg-background/90 px-3 backdrop-blur-md sm:px-6">
          {/* Left: Sidebar Toggle, Quick Actions & Brand */}
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleToggleSidebar}
              aria-label={isSidebarOpen && !isMobile ? 'Collapse sidebar' : 'Expand sidebar'}
              title={isSidebarOpen && !isMobile ? 'Collapse sidebar (Ctrl+B)' : 'Expand sidebar (Ctrl+B)'}
              className="h-8 w-8 rounded-lg text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            >
              <PanelLeft className="h-4 w-4" />
            </Button>

            {/* When sidebar is collapsed (or on mobile), keep New Chat and Search buttons visible! */}
            {(!isSidebarOpen || isMobile) && (
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleNewChat}
                  disabled={isLoading}
                  aria-label="Start new chat"
                  title="New chat (Ctrl+Shift+O)"
                  className="h-8 w-8 rounded-lg text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsSearchDialogOpen(true)}
                  aria-label="Search conversations"
                  title="Search conversations (Ctrl+K)"
                  className="h-8 w-8 rounded-lg text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                >
                  <Search className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            <div className="flex items-center gap-2 pl-1">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-background">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-sm font-semibold tracking-tight text-foreground">Prince</span>
                <span className="hidden text-[10px] text-muted-foreground/80 sm:inline-block">AI Studio</span>
              </div>
            </div>
          </div>

        {/* Center: Model Selector Pill */}
        <div className="flex items-center">
          <Popover open={isModelPickerOpen} onOpenChange={setIsModelPickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="group inline-flex max-w-[200px] items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-3 py-1.5 text-xs font-medium text-foreground transition-all hover:border-border hover:bg-muted/80 sm:max-w-[280px]"
                aria-label="Choose model"
              >
                <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  {selectedModelMetadata?.name || selectedOpenRouterModel || 'Choose model'}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="center"
              className="w-[min(94vw,34rem)] rounded-2xl border border-border/80 bg-popover/98 p-3 shadow-2xl backdrop-blur-xl"
            >
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <div>
                  <p className="text-xs font-semibold text-foreground">Select Model</p>
                  <p className="text-[11px] text-muted-foreground">Search available OpenRouter models</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => fetchOpenRouterModels(openRouterApiKey)}
                  disabled={isFetchingOpenRouterModels || !openRouterApiKey.trim()}
                  className="h-7 gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <RefreshCw className={cn('h-3 w-3', isFetchingOpenRouterModels && 'animate-spin')} />
                  <span>Refresh</span>
                </Button>
              </div>

              <div className="relative mb-2">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={openRouterModelSearch}
                  onChange={(event) => setOpenRouterModelSearch(event.target.value)}
                  placeholder="Search by name, provider, or ID..."
                  className="h-9 rounded-xl border-border/60 bg-muted/30 pl-8 text-xs"
                />
              </div>

              {/* Category Filter Chips */}
              <div className="mb-2 flex flex-wrap gap-1 px-1">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'vision', label: 'Vision' },
                    { id: 'image', label: 'Image Output' },
                    { id: 'file', label: 'Documents' },
                  ] as const
                ).map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setModelCategory(cat.id)}
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                      modelCategory === cat.id
                        ? 'bg-foreground text-background'
                        : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              <div className="max-h-[min(50vh,24rem)] overflow-y-auto rounded-xl border border-border/50 bg-background/50 divide-y divide-border/40">
                {filteredOpenRouterModels.length > 0 ? (
                  filteredOpenRouterModels.map((model) => {
                    const isSelected = model.id === selectedOpenRouterModel;
                    const inputPrice = formatPricePerMillion(model.pricing?.prompt);
                    const outputPrice = formatPricePerMillion(model.pricing?.completion);

                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => {
                          setSelectedOpenRouterModel(model.id);
                          setIsModelPickerOpen(false);
                        }}
                        className={cn(
                          'flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60',
                          isSelected && 'bg-muted/80'
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-xs font-semibold text-foreground">
                              {model.name || model.id}
                            </span>
                            {model.architecture?.output_modalities?.includes('image') ? (
                              <span className="rounded-md bg-amber-500/10 px-1.5 py-0.2 text-[9px] font-medium text-amber-600 dark:text-amber-400">
                                Image
                              </span>
                            ) : null}
                            {model.architecture?.input_modalities?.includes('image') ? (
                              <span className="rounded-md bg-violet-500/10 px-1.5 py-0.2 text-[9px] font-medium text-violet-600 dark:text-violet-400">
                                Vision
                              </span>
                            ) : null}
                            {model.architecture?.input_modalities?.includes('file') ? (
                              <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.2 text-[9px] font-medium text-emerald-600 dark:text-emerald-400">
                                File
                              </span>
                            ) : null}
                          </div>
                          <p className="truncate text-[10px] text-muted-foreground font-mono mt-0.5">
                            {model.id}
                          </p>
                          {inputPrice || outputPrice ? (
                            <div className="mt-1 flex gap-2 text-[10px] text-muted-foreground/80 font-mono">
                              {inputPrice ? <span>In: {inputPrice}</span> : null}
                              {outputPrice ? <span>Out: {outputPrice}</span> : null}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {model.context_length ? (
                            <span className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[9px] text-muted-foreground font-mono">
                              {Math.round(model.context_length / 1024)}k
                            </span>
                          ) : null}
                          {isSelected ? (
                            <Check className="h-3.5 w-3.5 text-foreground" />
                          ) : null}
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    {openRouterApiKey.trim()
                      ? 'No models match your filter.'
                      : 'Add an API key to load models.'}
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-1">
          {/* Response Controls */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Response controls"
                title="Response controls"
                className="relative h-8 w-8 rounded-lg text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {reasoningEffort || systemPrompt.trim() ? (
                  <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-foreground" />
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-[min(92vw,22rem)] rounded-2xl border border-border/80 bg-popover/98 p-4 shadow-2xl backdrop-blur-xl"
            >
              <div className="mb-3">
                <p className="text-xs font-semibold text-foreground">Response Controls</p>
                <p className="text-[11px] text-muted-foreground">Settings applied to following messages</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="space-y-0.5">
                    <Label htmlFor="popover-reasoning-effort" className="text-xs font-medium">
                      Reasoning effort
                    </Label>
                    <p className="text-[11px] text-muted-foreground">
                      {selectedModelSupportsReasoningEffort
                        ? 'Thinking depth for reasoning models'
                        : 'Not supported by current model'}
                    </p>
                  </div>
                  <Select
                    value={
                      reasoningEffort && selectedReasoningEffortIsAvailable
                        ? reasoningEffort
                        : 'default'
                    }
                    onValueChange={(value) =>
                      setReasoningEffort(value === 'default' ? '' : (value as ReasoningEffort))
                    }
                    disabled={!selectedModelSupportsReasoningEffort}
                  >
                    <SelectTrigger id="popover-reasoning-effort" className="h-8 rounded-lg text-xs">
                      <SelectValue placeholder="Model default" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default" className="text-xs">Model default</SelectItem>
                      {reasoningEffortOptions.map((effort) => (
                        <SelectItem key={effort} value={effort} className="text-xs">
                          {effort === 'xhigh' ? 'Extra high' : effort[0].toUpperCase() + effort.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 border-t border-border/50 pt-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="popover-system-prompt" className="text-xs font-medium">
                      System instructions
                    </Label>
                    {systemPrompt.trim() ? (
                      <button
                        type="button"
                        onClick={() => setSystemPrompt('')}
                        className="text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                  <Textarea
                    id="popover-system-prompt"
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="e.g. Provide direct, concise answers with minimal boilerplate."
                    className="min-h-[68px] max-h-32 resize-y rounded-xl border-border/60 bg-muted/30 p-2 text-xs"
                  />
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Export Conversation */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleExportConversation}
            disabled={messages.length === 0}
            aria-label="Export conversation as Markdown"
            title="Export conversation as Markdown"
            className="h-8 w-8 rounded-lg text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground disabled:opacity-30"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>

          {/* Account Balance / Credits Pill */}
          {openRouterApiKey.trim() ? (
            <button
              type="button"
              onClick={() => setIsOpenRouterDialogOpen(true)}
              title="OpenRouter account credits & key details"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-2.5 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted/70 hover:text-foreground"
            >
              <Wallet className="h-3.5 w-3.5 text-emerald-500" />
              {isLoadingKeyInfo && !openRouterKeyInfo ? (
                <span className="text-[11px] font-mono">...</span>
              ) : openRouterKeyInfo?.remaining_credits !== undefined && openRouterKeyInfo.remaining_credits !== null ? (
                <span className="font-mono text-[11px] font-medium text-foreground">
                  ${Math.max(0, openRouterKeyInfo.remaining_credits).toFixed(2)}
                </span>
              ) : openRouterKeyInfo?.usage !== undefined ? (
                <span className="font-mono text-[11px] font-medium text-foreground">
                  ${openRouterKeyInfo.usage.toFixed(2)} used
                </span>
              ) : (
                <span className="text-[11px]">Credits</span>
              )}
            </button>
          ) : null}

          {/* API Key */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsOpenRouterDialogOpen(true)}
            aria-label="OpenRouter API key"
            title="OpenRouter API key"
            className="relative h-8 w-8 rounded-lg text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
          >
            <KeyRound className="h-3.5 w-3.5" />
            {!openRouterApiKey.trim() ? (
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
            ) : null}
          </Button>

          {/* Theme Toggle */}
          <ThemeToggle />
        </div>
      </header>

      {/* Main Conversation Area */}
      <main className="relative min-h-0 flex-1 overflow-hidden">
        <ScrollArea ref={scrollAreaRef} className="h-full">
          <div className="mx-auto min-h-full w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
            {/* Empty State */}
            {messages.length === 0 ? (
              <div className="flex min-h-[calc(100vh-220px)] flex-col items-center justify-center text-center">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-border/80 bg-muted/40 text-foreground shadow-2xs">
                  <Bot className="h-5 w-5" />
                </div>
                <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                  What would you like to explore?
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedModelMetadata?.name || selectedOpenRouterModel
                    ? `Ready with ${selectedModelMetadata?.name || selectedOpenRouterModel}`
                    : 'Choose a model from the top to begin'}
                </p>

                {!openRouterApiKey.trim() ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsOpenRouterDialogOpen(true)}
                    className="mt-5 h-8 gap-1.5 rounded-full border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-accent"
                  >
                    <KeyRound className="h-3 w-3 text-amber-500" />
                    <span>Enter OpenRouter API key</span>
                  </Button>
                ) : (
                  <div className="mt-6 grid w-full max-w-lg gap-2 text-left sm:grid-cols-3">
                    {SUGGESTED_PROMPTS.map((item) => (
                      <button
                        key={item.title}
                        type="button"
                        onClick={() => handleSelectSuggestedPrompt(item.prompt)}
                        className="group flex flex-col justify-between rounded-xl border border-border/60 bg-muted/20 p-3 transition-all hover:border-border hover:bg-muted/50"
                      >
                        <span className="text-xs font-semibold text-foreground group-hover:text-primary">
                          {item.title}
                        </span>
                        <span className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                          {item.prompt}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {/* Messages */}
            {messages.map((message, index) => (
              <div
                key={index}
                className={cn(
                  'group flex flex-col',
                  message.role === 'user' ? 'items-end' : 'items-start'
                )}
              >
                {/* User Message */}
                {message.role === 'user' ? (
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
                    {editingMessageIndex === index ? (
                      <div className="w-full min-w-[260px] rounded-2xl border border-border/80 bg-muted/40 p-2.5 sm:min-w-[340px]">
                        <Textarea
                          value={editingMessageContent}
                          onChange={(e) => setEditingMessageContent(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              void handleSaveEdit();
                            } else if (e.key === 'Escape') {
                              handleCancelEdit();
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
                            onClick={handleCancelEdit}
                            className="h-6 rounded-md px-2 text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void handleSaveEdit()}
                            disabled={!editingMessageContent.trim() || isLoading}
                            className="h-6 rounded-md bg-foreground px-2 text-[11px] font-medium text-background hover:bg-foreground/90 disabled:opacity-30"
                          >
                            Save
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="relative rounded-2xl border border-border/50 bg-secondary/70 px-3.5 py-2 text-sm leading-relaxed text-foreground dark:bg-zinc-800/80">
                        <div className="whitespace-pre-wrap break-words">{message.content}</div>

                        {/* Hover Action Bar */}
                        <div className="mt-1 flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => handleEditMessage(index)}
                            disabled={isLoading}
                            aria-label="Edit message"
                            title="Edit prompt"
                            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopy(message.content)}
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
                ) : (
                  /* Assistant Message: Clean, Borderless & Spacious */
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

                    {/* Assistant Content & Reasoning */}
                    {(() => {
                      const { displayReasoning, displayContent } = parseContentAndThinking(message);
                      const isCurrentlyStreaming = isLoading && index === messages.length - 1;
                      const hasReasoning = Boolean(displayReasoning || (isCurrentlyStreaming && message.reasoning));
                      const isThinkingStreaming = isCurrentlyStreaming && !displayContent && hasReasoning;

                      return (
                        <>
                          {/* Collapsible Thinking / Reasoning Accordion */}
                          {hasReasoning ? (
                            <ThinkingAccordion
                              thinking={displayReasoning}
                              isStreaming={isThinkingStreaming}
                              durationMs={message.reasoningTimeMs}
                            />
                          ) : null}

                          {/* Markdown Body with Math (KaTeX) and Code Syntax Highlighting */}
                          {displayContent ? (
                            <div className="prose prose-zinc dark:prose-invert max-w-none text-[13.5px] leading-relaxed break-words">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm, remarkMath]}
                                rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                                components={{
                                  p: ({ node, ...props }) => (
                                    <p className="mb-2 last:mb-0 leading-relaxed text-foreground" {...props} />
                                  ),
                                  ol: ({ node, ...props }) => (
                                    <ol className="my-2 ml-4 list-decimal space-y-1 text-foreground" {...props} />
                                  ),
                                  ul: ({ node, ...props }) => (
                                    <ul className="my-2 ml-4 list-disc space-y-1 text-foreground" {...props} />
                                  ),
                                  li: ({ node, ...props }) => <li className="leading-relaxed" {...props} />,
                                  code: ({ node, className, children, ...props }) =>
                                    className ? (
                                      <CodeSnippet className={className}>
                                        {children}
                                      </CodeSnippet>
                                    ) : (
                                      <code
                                        className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[12px] text-foreground"
                                        {...props}
                                      >
                                        {children}
                                      </code>
                                    ),
                                }}
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

                          {/* Assistant Footer: Token Usage & Actions */}
                          {(displayContent || displayReasoning) && (index < messages.length - 1 || !isLoading) ? (
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
                                      onClick={() => void handleRegenerate(index)}
                                      disabled={isLoading}
                                      aria-label="Regenerate response"
                                      title="Regenerate"
                                      className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                                    >
                                      <RefreshCw className="h-3 w-3" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenRetryPicker(index)}
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
                                  onClick={() => handleCopy(displayContent || message.content)}
                                  aria-label="Copy response"
                                  title="Copy response"
                                  className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                                >
                                  <Copy className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            ))}

            {/* Inline Error & Retry Banner */}
            {!isLoading &&
            messages.length > 0 &&
            messages[messages.length - 1].role === 'user' ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
                <div className="flex items-center gap-2 min-w-0">
                  <Bot className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Failed to get a response. Check your API key or model.</span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleErrorRetry()}
                  className="h-6 gap-1 rounded-md border-destructive/30 bg-destructive/10 px-2 text-[11px] text-destructive hover:bg-destructive/20"
                >
                  <RefreshCw className="h-2.5 w-2.5" />
                  <span>Retry</span>
                </Button>
              </div>
            ) : null}
          </div>
        </ScrollArea>

        {/* Floating Scroll-to-Bottom Button */}
        {showScrollToBottom && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={scrollToBottom}
            aria-label="Scroll to bottom"
            title="Scroll to bottom"
            className="absolute bottom-4 right-6 z-20 h-8 w-8 rounded-full border border-border/70 bg-background/90 shadow-md backdrop-blur-md hover:bg-muted"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
        )}
      </main>

      {/* Floating Modern Composer */}
      <footer className="z-10 shrink-0 px-3 pb-3 pt-1 sm:px-6 sm:pb-4">
        <div className="mx-auto w-full max-w-3xl">
          {/* Pending Attachments Strip */}
          {pendingAttachments.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-1.5 px-1">
              {pendingAttachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-muted/50 py-1 pl-2 pr-1 text-xs"
                >
                  {attachment.kind === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={attachment.dataUrl}
                      alt=""
                      className="h-5 w-5 rounded object-cover"
                    />
                  ) : (
                    <FileText className="h-3 w-3 text-muted-foreground" />
                  )}
                  <span className="max-w-[120px] truncate text-[11px]">
                    {attachment.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removePendingAttachment(attachment.id)}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${attachment.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {/* Composer Card */}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <input
                ref={attachmentInputRef}
                type="file"
                accept={attachmentAccept}
                multiple
                onChange={handleAttachmentChange}
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
                            // @ts-expect-error - assigning mutable ref
                            composerTextareaRef.current = node;
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
                              onClick={() => setWebSearchEnabled((prev) => !prev)}
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

                          {/* Right: Submit / Stop */}
                          <div className="flex items-center gap-1.5">
                            {isLoading ? (
                              <button
                                type="button"
                                onClick={handleStopGenerating}
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
      </div>

      {/* OpenRouter API Key Dialog */}
      <Dialog
        open={isOpenRouterDialogOpen}
        onOpenChange={setIsOpenRouterDialogOpen}
      >
        <DialogContent className="rounded-2xl border border-border/80 bg-card p-5 shadow-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">
              OpenRouter API Key
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Stored locally in this browser. Requests are securely forwarded through your local proxy.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="openrouter-api-key" className="text-xs font-medium">
                  API Key
                </Label>
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-foreground hover:underline"
                >
                  <span>Get OpenRouter key</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <Input
                id="openrouter-api-key"
                type="password"
                value={openRouterApiKey}
                onChange={(event) => setOpenRouterApiKey(event.target.value)}
                placeholder="sk-or-v1-..."
                className="h-9 rounded-xl border-border/80 bg-muted/40 font-mono text-xs"
              />
            </div>

            {/* Live Account & Key Health Card */}
            {openRouterApiKey.trim() ? (
              <div className="space-y-2.5 rounded-xl border border-border/70 bg-muted/30 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-medium text-foreground">
                    <Wallet className="h-3.5 w-3.5 text-emerald-500" />
                    Account & Usage Monitor
                  </span>
                  <button
                    type="button"
                    onClick={() => void loadKeyInfo(openRouterApiKey)}
                    disabled={isLoadingKeyInfo}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                    title="Refresh balance and key info"
                  >
                    <RefreshCw className={cn('h-3 w-3', isLoadingKeyInfo && 'animate-spin')} />
                    <span>Refresh</span>
                  </button>
                </div>

                {isLoadingKeyInfo && !openRouterKeyInfo ? (
                  <div className="py-2 text-center text-[11px] text-muted-foreground">
                    Fetching OpenRouter account balance...
                  </div>
                ) : openRouterKeyInfo ? (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="rounded-lg border border-border/50 bg-background/60 p-2">
                      <p className="text-[10px] text-muted-foreground">Remaining Credits</p>
                      <p className="mt-0.5 font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                        {openRouterKeyInfo.remaining_credits !== null && openRouterKeyInfo.remaining_credits !== undefined
                          ? `$${Math.max(0, openRouterKeyInfo.remaining_credits).toFixed(4)}`
                          : openRouterKeyInfo.is_free_tier
                            ? 'Free Tier'
                            : 'Unlimited'}
                      </p>
                    </div>

                    <div className="rounded-lg border border-border/50 bg-background/60 p-2">
                      <p className="text-[10px] text-muted-foreground">Key Usage</p>
                      <p className="mt-0.5 font-mono text-sm font-semibold text-foreground">
                        ${(openRouterKeyInfo.usage ?? 0).toFixed(4)}
                        {openRouterKeyInfo.limit ? (
                          <span className="text-[10px] font-normal text-muted-foreground">
                            {' '}/ ${openRouterKeyInfo.limit.toFixed(2)}
                          </span>
                        ) : null}
                      </p>
                    </div>

                    {openRouterKeyInfo.label ? (
                      <div className="col-span-2 flex items-center justify-between border-t border-border/40 px-0.5 pt-1.5 text-[11px] text-muted-foreground">
                        <span>Key label:</span>
                        <span className="max-w-[200px] truncate font-mono font-medium text-foreground">
                          {openRouterKeyInfo.label}
                        </span>
                      </div>
                    ) : null}

                    {openRouterKeyInfo.rate_limit?.requests ? (
                      <div className="col-span-2 flex items-center justify-between px-0.5 text-[11px] text-muted-foreground">
                        <span>Rate limit:</span>
                        <span className="font-mono text-foreground">
                          {openRouterKeyInfo.rate_limit.requests} req / {openRouterKeyInfo.rate_limit.interval || 'sec'}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Unable to fetch account credits. Check that your API key is valid.
                  </p>
                )}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              onClick={handleSaveOpenRouterSettings}
              className="h-8 rounded-lg px-3 text-xs font-medium"
            >
              Save Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Retry With Another Model Dialog */}
      <Dialog
        open={isRetryModelPickerOpen}
        onOpenChange={(open) => {
          setIsRetryModelPickerOpen(open);
          if (!open) {
            setRetryTargetIndex(null);
            setRetryModelSearch('');
          }
        }}
      >
        <DialogContent className="rounded-2xl border border-border/80 bg-card p-5 shadow-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">
              Retry with Another Model
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Send the same prompt to a different model.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {retryTargetMessage?.modelId ? (
              <p className="rounded-xl border border-border/60 bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
                Original:{' '}
                <span className="font-semibold text-foreground">
                  {openRouterModels.find((m) => m.id === retryTargetMessage.modelId)?.name || retryTargetMessage.modelId}
                </span>
              </p>
            ) : null}

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={retryModelSearch}
                onChange={(event) => setRetryModelSearch(event.target.value)}
                placeholder="Search another model..."
                className="h-9 rounded-xl border-border/60 bg-muted/30 pl-8 text-xs"
              />
            </div>

            <div className="max-h-[min(50vh,20rem)] overflow-y-auto rounded-xl border border-border/50 bg-background/50 divide-y divide-border/40">
              {retryModels.length > 0 ? (
                retryModels.map((model) => {
                  const inputPrice = formatPricePerMillion(model.pricing?.prompt);
                  const outputPrice = formatPricePerMillion(model.pricing?.completion);

                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => void handleRetryWithModel(model.id)}
                      className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-foreground">{model.name || model.id}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{model.id}</p>
                        {inputPrice || outputPrice ? (
                          <div className="mt-1 flex gap-2 text-[10px] font-mono text-muted-foreground/80">
                            {inputPrice ? <span>In {inputPrice}</span> : null}
                            {outputPrice ? <span>Out {outputPrice}</span> : null}
                          </div>
                        ) : null}
                      </div>
                      {model.context_length ? (
                        <span className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground">
                          {Math.round(model.context_length / 1024)}k
                        </span>
                      ) : null}
                    </button>
                  );
                })
              ) : (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                  {openRouterModels.length
                    ? 'No compatible models found.'
                    : 'Add an API key to load models.'}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Search Conversations Modal (Accessible via Header Button or Ctrl+K) */}
      <SearchChatsDialog
        open={isSearchDialogOpen}
        onOpenChange={setIsSearchDialogOpen}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
      />
    </div>
  );
}
