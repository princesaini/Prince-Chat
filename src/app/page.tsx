'use client';

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Paperclip,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Square,
  User,
  X,
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
  usage?: MessageUsage;
  images?: {
    url: string;
    mediaType: string;
  }[];
};

type MessageUsage = {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number | null;
};

type Attachment = {
  id: string;
  name: string;
  mediaType: string;
  dataUrl: string;
  kind: 'image' | 'file';
};

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

type ReasoningEffort =
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

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
  updateAssistantUsage: (usage: unknown) => void
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
        const content = parsed.choices?.[0]?.delta?.content;
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

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border bg-muted/40 dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/70 px-3.5 py-1.5 text-xs text-muted-foreground dark:bg-zinc-900">
        <span className="font-mono text-[11px] uppercase tracking-wider">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={copyCode}
          className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-background hover:text-foreground"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-500" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy code</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 font-mono text-xs leading-relaxed text-foreground">
        <code>{children}</code>
      </pre>
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [openRouterModels, setOpenRouterModels] = useState<OpenRouterModel[]>([]);
  const [selectedOpenRouterModel, setSelectedOpenRouterModel] = useState<string>('');
  const [openRouterApiKey, setOpenRouterApiKey] = useState('');
  const [openRouterModelSearch, setOpenRouterModelSearch] = useState('');
  const [isOpenRouterDialogOpen, setIsOpenRouterDialogOpen] = useState(false);
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [isFetchingOpenRouterModels, setIsFetchingOpenRouterModels] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | ''>('');
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const { toast } = useToast();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

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
    const query = openRouterModelSearch.trim().toLowerCase();
    if (!query) {
      return true;
    }

    const inputModalities = model.architecture?.input_modalities ?? [];
    const outputModalities = model.architecture?.output_modalities ?? [];
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

  const appendAssistantText = (text: string) => {
    setMessages((prev) => {
      const updatedMessages = [...prev];
      const lastMessage = updatedMessages[updatedMessages.length - 1];

      if (lastMessage && lastMessage.role === 'assistant') {
        updatedMessages[updatedMessages.length - 1] = {
          ...lastMessage,
          content: lastMessage.content + text,
        };
      }

      return updatedMessages;
    });
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
      form.setFocus('message');
    }
    prevIsLoading.current = isLoading;
  }, [isLoading, form]);

  useEffect(() => {
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

    setOpenRouterApiKey(storedOpenRouterApiKey);
    setSelectedOpenRouterModel(storedOpenRouterModel);
    setWebSearchEnabled(storedWebSearchEnabled !== 'false');
    setReasoningEffort(
      REASONING_EFFORTS.includes(storedReasoningEffort as ReasoningEffort)
        ? (storedReasoningEffort as ReasoningEffort)
        : ''
    );

    if (storedOpenRouterApiKey) {
      void fetchOpenRouterModels(storedOpenRouterApiKey);
    }
  }, []);

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

  const handleNewChat = () => {
    setMessages([]);
    setPendingAttachments([]);
    form.reset();
  };

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
  };

  const handleSaveOpenRouterSettings = async () => {
    const sanitizedApiKey = openRouterApiKey.trim();

    localStorage.setItem(STORAGE_KEYS.openRouterApiKey, sanitizedApiKey);
    setIsOpenRouterDialogOpen(false);

    if (sanitizedApiKey) {
      await fetchOpenRouterModels(sanitizedApiKey);
    } else {
      setOpenRouterModels([]);
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
    setPendingAttachments([]);
    form.reset();
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

        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `Generated ${images.length} image${images.length > 1 ? 's' : ''}.`,
            images,
          },
        ]);
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
            messages: newMessages.map(toOpenRouterMessage),
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

        setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

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
            (usage) => updateAssistantUsage(usage, requestPricing)
          );
        }

        const finalChunk = bufferedChunk + decoder.decode();
        if (finalChunk.trim()) {
          parseOpenRouterChunk(
            `${finalChunk}\n\n`,
            appendAssistantText,
            (usage) => updateAssistantUsage(usage, requestPricing)
          );
        }
      }
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.log('Generation stopped by user.');
      } else {
        setMessages((prev) =>
          prev[prev.length - 1]?.role === 'assistant' ? prev.slice(0, -1) : prev
        );
        toast({
          variant: 'destructive',
          title: 'An error occurred.',
          description: 'Failed to get a response from OpenRouter. Check your API key and model.',
        });
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
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
    form.setFocus('message');
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      {/* Top Navigation Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/95 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold tracking-tight">Prince Chat</h1>
            <span className="hidden rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase sm:inline-block">
              OpenRouter
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {/* Model Selector Popover */}
          <Popover open={isModelPickerOpen} onOpenChange={setIsModelPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="h-9 max-w-[180px] justify-between gap-1.5 rounded-lg border-border px-2.5 text-xs font-medium hover:bg-accent sm:max-w-[280px] sm:px-3"
                aria-label="Choose model"
              >
                <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  {selectedModelMetadata?.name || selectedOpenRouterModel || 'Select model'}
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-[min(94vw,34rem)] rounded-xl border border-border bg-popover p-3 shadow-lg"
            >
              <div className="mb-2.5 flex items-center justify-between gap-2 px-1">
                <div>
                  <p className="text-sm font-semibold text-foreground">Select Model</p>
                  <p className="text-xs text-muted-foreground">Prices are per 1M tokens.</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fetchOpenRouterModels(openRouterApiKey)}
                  disabled={isFetchingOpenRouterModels || !openRouterApiKey.trim()}
                  className="h-8 gap-1.5 rounded-lg px-2.5 text-xs"
                >
                  {isFetchingOpenRouterModels ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  <span>Refresh</span>
                </Button>
              </div>

              <div className="relative mb-2">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={openRouterModelSearch}
                  onChange={(event) => setOpenRouterModelSearch(event.target.value)}
                  placeholder="Search models or capabilities..."
                  className="h-9 rounded-lg pl-8 text-xs"
                />
              </div>

              <div className="max-h-[min(55vh,26rem)] overflow-y-auto rounded-lg border border-border/70 bg-card divide-y divide-border/60">
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
                          'flex w-full items-start justify-between gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/70',
                          isSelected && 'bg-accent/90'
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-xs font-semibold text-foreground">
                              {model.id}
                            </span>
                            {model.architecture?.output_modalities?.includes('image') ? (
                              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                                Image
                              </span>
                            ) : null}
                            {model.architecture?.input_modalities?.includes('image') ? (
                              <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-600 dark:text-violet-400">
                                Vision
                              </span>
                            ) : null}
                            {model.architecture?.input_modalities?.includes('file') ? (
                              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                Files
                              </span>
                            ) : null}
                          </div>
                          {model.name && model.name !== model.id ? (
                            <p className="truncate text-[11px] text-muted-foreground mt-0.5">
                              {model.name}
                            </p>
                          ) : null}
                          {inputPrice || outputPrice ? (
                            <div className="mt-1 flex gap-2 text-[11px] text-muted-foreground font-mono">
                              {inputPrice ? <span>In: {inputPrice}</span> : null}
                              {outputPrice ? <span>Out: {outputPrice}</span> : null}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {model.context_length ? (
                            <span className="rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono">
                              {Math.round(model.context_length / 1024)}k ctx
                            </span>
                          ) : null}
                          {isSelected ? (
                            <Check className="h-4 w-4 text-primary" />
                          ) : null}
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    {openRouterApiKey.trim()
                      ? 'No models match your search.'
                      : 'Add an OpenRouter API key to load available models.'}
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>

          {/* Response Controls Popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Response controls"
                className="relative h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground"
              >
                <SlidersHorizontal className="h-4 w-4" />
                {webSearchEnabled || reasoningEffort ? (
                  <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary" />
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-[min(92vw,22rem)] rounded-xl border border-border bg-popover p-4 shadow-lg"
            >
              <div className="mb-3">
                <p className="text-sm font-semibold text-foreground">Response Controls</p>
                <p className="text-xs text-muted-foreground">Applied to the next response.</p>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="navbar-web-search" className="text-xs font-medium">
                      Web search
                    </Label>
                    <p className="text-[11px] text-muted-foreground">
                      Enable real-time web search tool
                    </p>
                  </div>
                  <Switch
                    id="navbar-web-search"
                    checked={webSearchEnabled}
                    onCheckedChange={setWebSearchEnabled}
                    aria-label="Enable web search"
                  />
                </div>

                <div className="space-y-2 border-t border-border pt-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="navbar-reasoning-effort" className="text-xs font-medium">
                      Reasoning effort
                    </Label>
                    <p className="text-[11px] text-muted-foreground">
                      {selectedModelSupportsReasoningEffort
                        ? 'Controls depth of model thinking'
                        : 'Not configurable on current model'}
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
                    <SelectTrigger id="navbar-reasoning-effort" className="h-8 rounded-lg text-xs">
                      <SelectValue placeholder="Model default" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Model default</SelectItem>
                      {reasoningEffortOptions.map((effort) => (
                        <SelectItem key={effort} value={effort} className="text-xs">
                          {effort === 'xhigh' ? 'Extra high' : effort[0].toUpperCase() + effort.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* API Key Dialog Trigger */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsOpenRouterDialogOpen(true)}
            aria-label="OpenRouter settings"
            className="relative h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground"
          >
            <KeyRound className="h-4 w-4" />
            {!openRouterApiKey.trim() ? (
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
            ) : null}
          </Button>

          {/* New Chat Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleNewChat}
            aria-label="New Chat"
            className="h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
          </Button>

          {/* Theme Toggle */}
          <ThemeToggle />
        </div>
      </header>

      {/* Main Chat Scroll Area */}
      <main className="min-h-0 flex-1 overflow-hidden">
        <ScrollArea ref={scrollAreaRef} className="h-full">
          <div className="mx-auto min-h-full w-full max-w-3xl space-y-6 px-4 py-8">
            {messages.length === 0 ? (
              <div className="flex min-h-[calc(100vh-230px)] flex-col items-center justify-center text-center">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-card text-primary shadow-xs">
                  <Bot className="h-6 w-6" />
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                  How can I help you today?
                </h2>
                <p className="mt-1.5 max-w-md text-xs text-muted-foreground">
                  {selectedModelMetadata?.name
                    ? `Active model: ${selectedModelMetadata.name}`
                    : 'Select a model and start chatting.'}
                </p>

                {!openRouterApiKey.trim() ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsOpenRouterDialogOpen(true)}
                    className="mt-4 gap-2 rounded-lg border-amber-500/30 bg-amber-500/10 text-xs font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    <span>Enter OpenRouter API key</span>
                  </Button>
                ) : (
                  <div className="mt-6 flex flex-wrap justify-center gap-2 max-w-lg">
                    {[
                      'Explain how quantum computing works simply',
                      'Write a clean React hook for debouncing',
                      'Analyze tradeoffs between SQL and NoSQL',
                    ].map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => handleSelectSuggestedPrompt(suggestion)}
                        className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-accent hover:text-foreground"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {messages.map((message, index) => (
              <div
                key={index}
                className={cn(
                  'flex items-start gap-3',
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                {message.role === 'assistant' ? (
                  <Avatar className="h-7 w-7 shrink-0 rounded-lg border border-border">
                    <AvatarFallback className="rounded-lg bg-muted text-[11px] font-semibold text-foreground">
                      AI
                    </AvatarFallback>
                  </Avatar>
                ) : null}

                <div
                  className={cn(
                    'group relative max-w-[85%] text-sm leading-relaxed sm:max-w-[78%]',
                    message.role === 'user'
                      ? 'rounded-2xl rounded-tr-xs bg-primary text-primary-foreground px-4 py-2.5 shadow-xs'
                      : 'rounded-2xl rounded-tl-xs border border-border/80 bg-card px-4 py-3 text-foreground shadow-xs'
                  )}
                >
                  <div className="flex flex-col gap-2">
                    {/* User Attachments Display */}
                    {message.attachments && message.attachments.length > 0 ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {message.attachments.map((attachment) =>
                          attachment.kind === 'image' ? (
                            <div
                              key={attachment.id}
                              className="overflow-hidden rounded-xl border border-border bg-background/50"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={attachment.dataUrl}
                                alt={attachment.name}
                                className="max-h-64 w-full object-contain"
                              />
                            </div>
                          ) : (
                            <div
                              key={attachment.id}
                              className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-background/50 px-2.5 py-1.5 text-xs"
                            >
                              <FileText className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{attachment.name}</span>
                            </div>
                          )
                        )}
                      </div>
                    ) : null}

                    {/* Assistant Generated Images */}
                    {message.images && message.images.length > 0 ? (
                      <div className="grid gap-3 sm:grid-cols-2 my-1">
                        {message.images.map((image, imageIndex) => (
                          <div
                            key={`${image.url.slice(0, 32)}-${imageIndex}`}
                            className="overflow-hidden rounded-xl border border-border bg-muted/20"
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

                    {/* Markdown Content */}
                    <div className="prose prose-sm dark:prose-invert max-w-none break-words">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ node, ...props }) => (
                            <p className="mb-2 last:mb-0 leading-relaxed" {...props} />
                          ),
                          ol: ({ node, ...props }) => (
                            <ol className="my-2 ml-4 list-decimal space-y-1" {...props} />
                          ),
                          ul: ({ node, ...props }) => (
                            <ul className="my-2 ml-4 list-disc space-y-1" {...props} />
                          ),
                          li: ({ node, ...props }) => <li className="leading-relaxed" {...props} />,
                          code: ({ node, className, children, ...props }) =>
                            className ? (
                              <CodeSnippet className={className}>
                                {children}
                              </CodeSnippet>
                            ) : (
                              <code
                                className={cn(
                                  'rounded px-1.5 py-0.5 font-mono text-[13px]',
                                  message.role === 'user'
                                    ? 'bg-white/20 text-white'
                                    : 'border border-border/60 bg-muted text-foreground'
                                )}
                                {...props}
                              >
                                {children}
                              </code>
                            ),
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>

                    {message.role === 'assistant' &&
                    (message.usage ||
                      (message.content && (index < messages.length - 1 || !isLoading))) ? (
                      <div className="mt-1 flex items-center justify-between gap-3 border-t border-border/60 pt-2">
                        {message.usage ? (
                          <span
                            className="truncate text-[10px] text-muted-foreground"
                            title={`Input: ${message.usage.inputTokens.toLocaleString()} tokens · Output: ${message.usage.outputTokens.toLocaleString()} tokens${message.usage.estimatedCost !== null ? ` · Estimated cost: ${formatEstimatedCost(message.usage.estimatedCost)}` : ''}`}
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

                        {message.content && (index < messages.length - 1 || !isLoading) ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCopy(message.content)}
                            aria-label="Copy message"
                            className="h-6 w-6 rounded text-muted-foreground opacity-60 transition-opacity hover:opacity-100 hover:text-foreground"
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>

                {message.role === 'user' ? (
                  <Avatar className="h-7 w-7 shrink-0 rounded-lg border border-border">
                    <AvatarFallback className="rounded-lg bg-primary/10 text-[11px] font-semibold text-primary">
                      <User className="h-3.5 w-3.5" />
                    </AvatarFallback>
                  </Avatar>
                ) : null}
              </div>
            ))}
          </div>
        </ScrollArea>
      </main>

      {/* Bottom Composer Area */}
      <footer className="shrink-0 border-t border-border bg-background px-4 pb-4 pt-3 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          {/* Pending Attachments Strip */}
          {pendingAttachments.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2 px-1">
              {pendingAttachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/60 py-1 pl-2 pr-1 text-xs text-foreground"
                >
                  {attachment.kind === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={attachment.dataUrl}
                      alt=""
                      className="h-6 w-6 rounded object-cover"
                    />
                  ) : (
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="max-w-[140px] truncate text-[11px] font-medium">
                    {attachment.name}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removePendingAttachment(attachment.id)}
                    className="h-5 w-5 rounded-md text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${attachment.name}`}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

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
                  <FormItem className="flex-1">
                    <FormControl>
                      <div className="relative flex items-center rounded-xl border border-border bg-card shadow-xs transition-all focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15">
                        {/* Attachments Button */}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => attachmentInputRef.current?.click()}
                          disabled={
                            isLoading ||
                            !selectedModelSupportsAttachments ||
                            !openRouterApiKey.trim()
                          }
                          className="h-9 w-9 shrink-0 ml-1 rounded-lg text-muted-foreground hover:text-foreground"
                          aria-label="Add images or documents"
                          title={
                            selectedModelSupportsAttachments
                              ? 'Add images or PDF documents'
                              : 'Choose a chat model that supports image or file input to add attachments'
                          }
                        >
                          {selectedModelSupportsImageInput && selectedModelSupportsFileInput ? (
                            <Paperclip className="h-4 w-4" />
                          ) : selectedModelSupportsImageInput ? (
                            <ImageIcon className="h-4 w-4" />
                          ) : (
                            <FileText className="h-4 w-4" />
                          )}
                        </Button>

                        {/* Text Input */}
                        <Input
                          placeholder={
                            selectedModelSupportsAttachments
                              ? 'Ask about an image, document, or topic...'
                              : 'Send a message...'
                          }
                          autoComplete="off"
                          {...field}
                          disabled={isLoading}
                          className="h-11 flex-1 border-0 bg-transparent px-2 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                        />

                        {/* Send / Stop Button */}
                        <div className="mr-1.5 shrink-0">
                          {isLoading ? (
                            <Button
                              type="button"
                              size="icon"
                              onClick={handleStopGenerating}
                              className="h-8 w-8 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              aria-label="Stop generating"
                            >
                              <Square className="h-3.5 w-3.5 fill-current" />
                              <span className="sr-only">Stop</span>
                            </Button>
                          ) : (
                            <Button
                              type="submit"
                              size="icon"
                              disabled={
                                (!field.value.trim() && pendingAttachments.length === 0) || isLoading
                              }
                              className="h-8 w-8 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                              aria-label="Send message"
                            >
                              <ArrowUp className="h-4 w-4" />
                              <span className="sr-only">Send</span>
                            </Button>
                          )}
                        </div>
                      </div>
                    </FormControl>
                  </FormItem>
                )}
              />
            </form>
          </Form>

          <p className="mt-2 text-center text-[11px] text-muted-foreground/80">
            OpenRouter models can make mistakes. Always verify critical details.
          </p>
        </div>
      </footer>

      {/* OpenRouter API Key Dialog */}
      <Dialog
        open={isOpenRouterDialogOpen}
        onOpenChange={setIsOpenRouterDialogOpen}
      >
        <DialogContent className="rounded-xl border border-border bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold tracking-tight">
              OpenRouter API Key
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Your API key is stored locally in your browser and used to authenticate with OpenRouter.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="openrouter-api-key" className="text-xs font-medium">
                  API Key
                </Label>
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
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
                className="h-9 rounded-lg font-mono text-xs"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              onClick={handleSaveOpenRouterSettings}
              className="h-8 rounded-lg px-4 text-xs font-medium"
            >
              Save Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
