'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
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
import { ChatComposer } from '@/components/chat-composer';
import {
  ChatMessageItem,
  parseContentAndThinking,
  formatEstimatedCost,
} from '@/components/chat-message-item';
import { ScrollToBottomButton } from '@/components/scroll-to-bottom-button';
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
  getSession,
  saveSession,
  deleteSession,
  clearAllSessions,
  stripHeavyPayload,
  ACTIVE_SESSION_STORAGE_KEY,
  SIDEBAR_OPEN_STORAGE_KEY,
} from '@/lib/chat-sessions';
import { streamChatCompletion } from '@/lib/openrouter-stream';

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
  supported_parameters?: string[];
};

const REASONING_EFFORTS: ReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

const formatEffortLabel = (effort?: string | null): string => {
  switch (effort) {
    case 'none':
      return 'None';
    case 'minimal':
      return 'Minimal';
    case 'low':
      return 'Low';
    case 'medium':
      return 'Medium';
    case 'high':
      return 'High';
    case 'xhigh':
      return 'Extra High';
    case 'max':
      return 'Max';
    default:
      return effort ? effort[0].toUpperCase() + effort.slice(1) : '';
  }
};

const getModelReasoningEffortOptions = (
  model?: OpenRouterModel
): ReasoningEffort[] => {
  if (!model) return [];
  const supported = model.reasoning?.supported_efforts;
  if (Array.isArray(supported) && supported.length > 0) {
    const valid = supported.filter((e): e is ReasoningEffort =>
      REASONING_EFFORTS.includes(e as ReasoningEffort)
    );
    return valid.sort(
      (a, b) => REASONING_EFFORTS.indexOf(a) - REASONING_EFFORTS.indexOf(b)
    );
  }
  const hasReasoning = Boolean(
    model.reasoning ||
      model.supported_parameters?.includes('reasoning_effort') ||
      model.supported_parameters?.includes('reasoning')
  );
  if (hasReasoning) {
    return ['low', 'medium', 'high'];
  }
  return [];
};

const getModelDefaultReasoningEffort = (
  model?: OpenRouterModel,
  options?: ReasoningEffort[]
): ReasoningEffort | '' => {
  if (!model) return '';
  const availableOptions = options ?? getModelReasoningEffortOptions(model);
  if (availableOptions.length === 0) return '';

  if (
    model.reasoning?.default_effort &&
    availableOptions.includes(model.reasoning.default_effort as ReasoningEffort)
  ) {
    return model.reasoning.default_effort as ReasoningEffort;
  }
  if (availableOptions.includes('medium')) {
    return 'medium';
  }
  return availableOptions[0] || '';
};

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
  openRouterApiKey: 'prince-ai-studio-openrouter-api-key',
  openRouterModel: 'prince-ai-studio-openrouter-model',
  webSearchEnabled: 'prince-ai-studio-web-search-enabled',
  reasoningEffort: 'prince-ai-studio-reasoning-effort',
  systemPrompt: 'prince-ai-studio-system-prompt',
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
  const reasoningEffortOptions = getModelReasoningEffortOptions(selectedModelMetadata);
  const modelDefaultEffort = getModelDefaultReasoningEffort(
    selectedModelMetadata,
    reasoningEffortOptions
  );
  const selectedModelSupportsReasoningEffort = reasoningEffortOptions.length > 0;
  const effectiveReasoningEffort =
    reasoningEffort && reasoningEffortOptions.includes(reasoningEffort)
      ? reasoningEffort
      : modelDefaultEffort;
  const selectedReasoningEffortIsAvailable =
    !effectiveReasoningEffort || reasoningEffortOptions.includes(effectiveReasoningEffort);

  const filteredOpenRouterModels = useMemo(() => {
    return openRouterModels.filter((model) => {
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
  }, [openRouterModels, modelCategory, openRouterModelSearch]);

  const retryTargetMessage =
    retryTargetIndex === null ? undefined : messages[retryTargetIndex];
  const retryPromptMessage = useMemo(() => {
    if (retryTargetIndex === null) return undefined;
    return [...messages.slice(0, retryTargetIndex)]
      .reverse()
      .find((message) => message.role === 'user');
  }, [messages, retryTargetIndex]);

  const retryModels = useMemo(() => {
    return openRouterModels.filter((model) => {
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
  }, [openRouterModels, retryModelSearch, retryTargetMessage?.modelId, retryPromptMessage]);

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
        let chosen = currentModel;
        if (
          currentModel &&
          fetchedModels.some((model: OpenRouterModel) => model.id === currentModel)
        ) {
          chosen = currentModel;
        } else {
          const storedModel = localStorage.getItem(STORAGE_KEYS.openRouterModel);
          if (
            storedModel &&
            fetchedModels.some((model: OpenRouterModel) => model.id === storedModel)
          ) {
            chosen = storedModel;
          } else {
            chosen = currentModel || storedModel || '';
          }
        }

        const modelMeta = fetchedModels.find((model: OpenRouterModel) => model.id === chosen);
        if (modelMeta) {
          const opts = getModelReasoningEffortOptions(modelMeta);
          const def = getModelDefaultReasoningEffort(modelMeta, opts);
          setReasoningEffort((currentEffort) =>
            currentEffort && opts.includes(currentEffort) ? currentEffort : def
          );
        }

        return chosen;
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
      localStorage.getItem(STORAGE_KEYS.openRouterApiKey) ??
      localStorage.getItem('prince-chat-openrouter-api-key') ??
      '';
    const storedOpenRouterModel =
      localStorage.getItem(STORAGE_KEYS.openRouterModel) ??
      localStorage.getItem('prince-chat-openrouter-model') ??
      '';
    const storedWebSearchEnabled =
      localStorage.getItem(STORAGE_KEYS.webSearchEnabled) ??
      localStorage.getItem('prince-chat-web-search-enabled');
    const storedReasoningEffort =
      localStorage.getItem(STORAGE_KEYS.reasoningEffort) ??
      localStorage.getItem('prince-chat-reasoning-effort');
    const storedSystemPrompt =
      localStorage.getItem(STORAGE_KEYS.systemPrompt) ??
      localStorage.getItem('prince-chat-system-prompt');

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

        setSessions(storedSessions.map(stripHeavyPayload));

        const savedActiveId =
          localStorage.getItem(STORAGE_KEYS.activeSessionId) ??
          localStorage.getItem('prince-chat-active-session-id');
        const targetSession = storedSessions.find((s) => s.id === savedActiveId);

        if (targetSession) {
          setActiveSessionId(targetSession.id);
          const fullSession = await getSession(targetSession.id);
          setMessages(fullSession?.messages || targetSession.messages);
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
          const fullLatest = await getSession(latest.id);
          setMessages(fullLatest?.messages || latest.messages);
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

    const storedSidebarOpen =
      localStorage.getItem(STORAGE_KEYS.sidebarOpen) ??
      localStorage.getItem('prince-chat-sidebar-open');
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
        const nextSessions = [stripHeavyPayload(updatedSession), ...filtered];
        nextSessions.sort((a, b) => b.updatedAt - a.updatedAt);

        void saveSession(updatedSession);

        return nextSessions;
      });
    },
    [activeSessionId, selectedModel, systemPrompt, webSearchEnabled, reasoningEffort]
  );

  const handleSelectSession = async (id: string) => {
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

    const fullTarget = await getSession(id);
    const target = fullTarget || sessions.find((s) => s.id === id);
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
          const fullNext = await getSession(nextSession.id);
          setMessages(fullNext?.messages || nextSession.messages);
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
    if (!viewport) return;

    const distanceFromBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const isNearBottom = distanceFromBottom < 150;
    const lastMessage = messages[messages.length - 1];
    const isUserMessage = lastMessage?.role === 'user';

    if (isNearBottom || isUserMessage) {
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: isLoading ? 'auto' : 'smooth',
      });
    }
  }, [messages, isLoading]);

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
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: '', modelId: selectedModel },
        ]);

        await streamChatCompletion({
          apiKey: openRouterApiKey,
          modelId: selectedModel,
          messages: newMessages.map(toOpenRouterMessage),
          systemPrompt,
          webSearchEnabled,
          reasoningEffort:
            effectiveReasoningEffort &&
            selectedModelSupportsReasoningEffort &&
            selectedReasoningEffortIsAvailable
              ? effectiveReasoningEffort
              : undefined,
          signal: controller.signal,
          onTextChunk: appendAssistantText,
          onReasoningChunk: appendAssistantReasoning,
          onUsage: (usage) => updateAssistantUsage(usage, requestPricing),
        });

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
    const retryEffortOptions = getModelReasoningEffortOptions(retryModelMetadata);
    const retryModelDefault = getModelDefaultReasoningEffort(
      retryModelMetadata,
      retryEffortOptions
    );
    const retryModelSupportsReasoningEffort = retryEffortOptions.length > 0;
    const retryReasoningEffort =
      effectiveReasoningEffort && retryEffortOptions.includes(effectiveReasoningEffort)
        ? effectiveReasoningEffort
        : retryModelDefault;

    setIsRetryModelPickerOpen(false);
    setRetryTargetIndex(null);
    setIsLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '', modelId },
      ]);

      await streamChatCompletion({
        apiKey: openRouterApiKey,
        modelId,
        messages: retryMessages.map(toOpenRouterMessage),
        systemPrompt,
        webSearchEnabled,
        reasoningEffort:
          retryReasoningEffort && retryModelSupportsReasoningEffort
            ? retryReasoningEffort
            : undefined,
        signal: controller.signal,
        onTextChunk: appendAssistantText,
        onReasoningChunk: appendAssistantReasoning,
        onUsage: (usage) => updateAssistantUsage(usage, retryModelMetadata?.pricing),
      });

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
    const regenerateEffortOptions = getModelReasoningEffortOptions(regenerateModelMetadata);
    const regenerateModelDefault = getModelDefaultReasoningEffort(
      regenerateModelMetadata,
      regenerateEffortOptions
    );
    const regenerateSupportsReasoningEffort = regenerateEffortOptions.length > 0;
    const regenerateReasoningEffort =
      effectiveReasoningEffort &&
      regenerateEffortOptions.includes(effectiveReasoningEffort)
        ? effectiveReasoningEffort
        : regenerateModelDefault;

    try {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '', modelId },
      ]);

      await streamChatCompletion({
        apiKey: openRouterApiKey,
        modelId,
        messages: baseMessages.map(toOpenRouterMessage),
        systemPrompt,
        webSearchEnabled,
        reasoningEffort:
          regenerateReasoningEffort && regenerateSupportsReasoningEffort
            ? regenerateReasoningEffort
            : undefined,
        signal: controller.signal,
        onTextChunk: appendAssistantText,
        onReasoningChunk: appendAssistantReasoning,
        onUsage: (usage) => updateAssistantUsage(usage, regenerateModelMetadata?.pricing),
      });

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
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '', modelId: selectedModel },
      ]);

      await streamChatCompletion({
        apiKey: openRouterApiKey,
        modelId: selectedModel,
        messages: newMessages.map(toOpenRouterMessage),
        systemPrompt,
        webSearchEnabled,
        reasoningEffort:
          effectiveReasoningEffort &&
          selectedModelSupportsReasoningEffort &&
          selectedReasoningEffortIsAvailable
            ? effectiveReasoningEffort
            : undefined,
        signal: controller.signal,
        onTextChunk: appendAssistantText,
        onReasoningChunk: appendAssistantReasoning,
        onUsage: (usage) => updateAssistantUsage(usage, requestPricing),
      });

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
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '', modelId: selectedModel },
      ]);

      await streamChatCompletion({
        apiKey: openRouterApiKey,
        modelId: selectedModel,
        messages: messages.map(toOpenRouterMessage),
        systemPrompt,
        webSearchEnabled,
        reasoningEffort:
          effectiveReasoningEffort &&
          selectedModelSupportsReasoningEffort &&
          selectedReasoningEffortIsAvailable
            ? effectiveReasoningEffort
            : undefined,
        signal: controller.signal,
        onTextChunk: appendAssistantText,
        onReasoningChunk: appendAssistantReasoning,
        onUsage: (usage) => updateAssistantUsage(usage, requestPricing),
      });

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
    const sessionTitle = currentSession?.title || 'Prince AI Studio Export';

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
      : 'prince-ai-studio';
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
      {/* Ambient Liquid Glass Mesh Glow Orbs */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-[480px] w-[480px] rounded-full bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-transparent blur-3xl dark:from-indigo-500/15 dark:via-purple-600/10" />
        <div className="absolute -right-32 top-1/4 h-[520px] w-[520px] rounded-full bg-gradient-to-bl from-sky-400/10 via-cyan-500/5 to-transparent blur-3xl dark:from-sky-500/12 dark:via-cyan-500/8" />
        <div className="absolute bottom-8 left-1/3 h-[420px] w-[420px] rounded-full bg-gradient-to-tr from-violet-500/8 via-pink-500/5 to-transparent blur-3xl dark:from-violet-500/10 dark:via-pink-500/5" />
      </div>

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
        <header className="z-10 flex h-14 shrink-0 items-center justify-between border-b border-border/30 bg-background/60 px-3 backdrop-blur-xl sm:px-6 shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:border-white/5 dark:bg-background/40">
          {/* Left: Sidebar Toggle, Quick Actions & Brand */}
          <div className="flex items-center gap-1.5">
            {/* When sidebar is collapsed (or on mobile), show Toggle, New Chat, and Search buttons */}
            {(!isSidebarOpen || isMobile) && (
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleToggleSidebar}
                  aria-label="Expand sidebar"
                  title="Expand sidebar (Ctrl+B)"
                  className="h-8 w-8 rounded-lg text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                >
                  <PanelLeft className="h-4 w-4" />
                </Button>

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

            <div className={cn('flex items-center gap-2', (!isSidebarOpen || isMobile) && 'pl-1')}>
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-background shadow-sm ring-1 ring-white/20">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
              <span className="text-sm font-semibold tracking-tight text-foreground">
                Prince AI Studio
              </span>
            </div>
          </div>

        {/* Center: Model Selector Pill */}
        <div className="flex items-center">
          <Popover open={isModelPickerOpen} onOpenChange={setIsModelPickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="group inline-flex max-w-[200px] items-center gap-1.5 rounded-full border border-border/50 bg-card/60 px-3.5 py-1.5 text-xs font-medium text-foreground backdrop-blur-xl shadow-[0_2px_12px_rgba(0,0,0,0.03),inset_0_1px_1px_rgba(255,255,255,0.2)] transition-all hover:border-border/80 hover:bg-card/90 sm:max-w-[280px] dark:border-white/10 dark:bg-white/[0.04] dark:shadow-[0_2px_16px_rgba(0,0,0,0.3),inset_0_1px_1px_rgba(255,255,255,0.08)] dark:hover:bg-white/[0.08]"
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
              className="w-[min(94vw,34rem)] rounded-2xl border border-border/60 bg-popover/80 p-3.5 shadow-[0_20px_60px_rgba(0,0,0,0.15),inset_0_1px_1px_rgba(255,255,255,0.2)] backdrop-blur-2xl dark:border-white/10 dark:bg-zinc-900/80 dark:shadow-[0_24px_70px_rgba(0,0,0,0.6),inset_0_1px_1px_rgba(255,255,255,0.08)]"
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
                          const nextOptions = getModelReasoningEffortOptions(model);
                          const nextDefault = getModelDefaultReasoningEffort(model, nextOptions);
                          setReasoningEffort(nextDefault);
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
                {systemPrompt.trim() ? (
                  <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-foreground" />
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-[min(92vw,22rem)] rounded-2xl border border-border/60 bg-popover/80 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.15),inset_0_1px_1px_rgba(255,255,255,0.2)] backdrop-blur-2xl dark:border-white/10 dark:bg-zinc-900/80 dark:shadow-[0_24px_70px_rgba(0,0,0,0.6),inset_0_1px_1px_rgba(255,255,255,0.08)]"
            >
              <div className="mb-3">
                <p className="text-xs font-semibold text-foreground">Response Controls</p>
                <p className="text-[11px] text-muted-foreground">Settings applied to following messages</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
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

          {/* Theme Toggle */}
          <ThemeToggle />

          {/* Account Balance / Credits Pill */}
          <button
            type="button"
            onClick={() => setIsOpenRouterDialogOpen(true)}
            title={
              openRouterApiKey.trim()
                ? 'OpenRouter account credits & key details'
                : 'Enter OpenRouter API key'
            }
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/50 bg-card/50 px-2.5 text-xs text-muted-foreground backdrop-blur-md shadow-[0_2px_8px_rgba(0,0,0,0.02),inset_0_1px_1px_rgba(255,255,255,0.15)] transition-all hover:border-border hover:bg-card/80 hover:text-foreground dark:border-white/10 dark:bg-white/[0.04] dark:shadow-[0_2px_12px_rgba(0,0,0,0.3),inset_0_1px_1px_rgba(255,255,255,0.06)] dark:hover:bg-white/[0.08]"
          >
            <Wallet
              className={cn(
                'h-3.5 w-3.5',
                openRouterApiKey.trim() ? 'text-emerald-500' : 'text-amber-500'
              )}
            />
            {!openRouterApiKey.trim() ? (
              <span className="text-[11px] font-medium text-foreground">API Key</span>
            ) : isLoadingKeyInfo && !openRouterKeyInfo ? (
              <span className="text-[11px] font-mono">...</span>
            ) : openRouterKeyInfo?.remaining_credits !== undefined &&
              openRouterKeyInfo.remaining_credits !== null ? (
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
              <ChatMessageItem
                key={index}
                message={message}
                index={index}
                totalMessages={messages.length}
                isCurrentlyStreaming={isLoading && index === messages.length - 1}
                isLoading={isLoading}
                isEditing={editingMessageIndex === index}
                editingMessageContent={editingMessageContent}
                onEditMessage={handleEditMessage}
                onSaveEdit={() => void handleSaveEdit()}
                onCancelEdit={handleCancelEdit}
                onEditingContentChange={(val) => setEditingMessageContent(val)}
                onCopy={handleCopy}
                onRegenerate={(idx) => void handleRegenerate(idx)}
                onOpenRetryPicker={handleOpenRetryPicker}
              />
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
        <ScrollToBottomButton scrollAreaRef={scrollAreaRef} />
      </main>

      {/* Floating Modern Composer */}
      {/* Message Composer */}
      <ChatComposer
        form={form}
        isLoading={isLoading}
        openRouterApiKey={openRouterApiKey}
        selectedModelOutputsImage={selectedModelOutputsImage}
        selectedModelSupportsAttachments={selectedModelSupportsAttachments}
        selectedModelSupportsImageInput={selectedModelSupportsImageInput}
        attachmentAccept={attachmentAccept}
        pendingAttachments={pendingAttachments}
        onRemoveAttachment={removePendingAttachment}
        onAttachmentChange={handleAttachmentChange}
        attachmentInputRef={attachmentInputRef}
        composerTextareaRef={composerTextareaRef}
        webSearchEnabled={webSearchEnabled}
        onToggleWebSearch={() => setWebSearchEnabled((prev) => !prev)}
        selectedModelSupportsReasoningEffort={selectedModelSupportsReasoningEffort}
        reasoningEffortOptions={reasoningEffortOptions}
        effectiveReasoningEffort={effectiveReasoningEffort}
        modelDefaultEffort={modelDefaultEffort}
        formatEffortLabel={formatEffortLabel}
        onSelectReasoningEffort={(effort) => setReasoningEffort(effort)}
        onSubmit={onSubmit}
        onStop={handleStopGenerating}
      />
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
