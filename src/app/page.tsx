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
  ChevronDown,
  Copy,
  FileText,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Paperclip,
  Plus,
  Sparkles,
  Square,
  SlidersHorizontal,
  User,
  X,
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
  images?: {
    url: string;
    mediaType: string;
  }[];
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

function parseOpenRouterChunk(
  chunk: string,
  appendAssistantText: (text: string) => void
) {
  const events = chunk.split('\n\n');

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

        if (parsed.error?.message) {
          throw new Error(parsed.error.message);
        }
      } catch (error) {
        console.error('Error parsing OpenRouter streaming data:', error);
      }
    }
  }
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

    return (
      model.id.toLowerCase().includes(query) ||
      model.name.toLowerCase().includes(query)
    );
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

  const fetchOpenRouterModels = async (apiKey: string) => {
    if (!apiKey.trim()) {
      setOpenRouterModels([]);
      return;
    }

    setIsFetchingOpenRouterModels(true);

    try {
      const response = await fetch('/api/openrouter/api/v1/models?output_modalities=all&sort=most-popular', {
        headers: {
          'x-openrouter-api-key': apiKey.trim(),
        },
      });

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

    // Scroll only the Radix chat viewport. Element.scrollIntoView() may select
    // the document as its scroll container, which moves the fixed app header.
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
          description: `${selectedModelMetadata?.name || 'This model'} cannot receive ${isImage ? 'images' : 'PDF documents'}.`,
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

    if (!selectedModel) {
      toast({
        variant: 'destructive',
        title: 'No model selected.',
        description: 'Please enter or select an OpenRouter model first.',
      });
      return;
    }

    if (!openRouterApiKey.trim()) {
      toast({
        variant: 'destructive',
        title: 'OpenRouter API key required.',
        description: 'Add your OpenRouter API key before sending a message.',
      });
      setIsOpenRouterDialogOpen(true);
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
      // Image-capable generation models can also accept image/file input. Those
      // requests use chat completions; only prompt-only requests use /images.
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

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          parseOpenRouterChunk(chunk, appendAssistantText);
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

  return (
    <div className="liquid-app">
      <div className="liquid-orb liquid-orb-one" />
      <div className="liquid-orb liquid-orb-two" />
      <div className="liquid-orb liquid-orb-three" />

      <div className="liquid-shell">
        <header className="liquid-header">
          <div className="flex min-w-0 items-center gap-3">
            <div className="brand-mark">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="hidden min-w-0 min-[390px]:block">
              <h1 className="text-[15px] font-semibold tracking-[-0.02em]">Prince Chat</h1>
              <p className="hidden text-xs text-muted-foreground sm:block">Your private AI workspace</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <Popover open={isModelPickerOpen} onOpenChange={setIsModelPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="liquid-input h-9 w-9 rounded-full px-0 text-xs sm:w-auto sm:max-w-[270px] sm:px-3"
                  aria-label="Choose model"
                >
                  <Bot className="h-4 w-4 shrink-0 sm:mr-2" />
                  <span className="hidden min-w-0 truncate sm:block">
                    {selectedModelMetadata?.name || selectedOpenRouterModel || 'Choose model'}
                  </span>
                  <ChevronDown className="ml-2 hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:block" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="glass-dialog w-[min(92vw,32rem)] border-white/50 p-3 dark:border-white/10"
              >
                <div className="mb-3 flex items-center justify-between gap-3 px-1">
                  <div>
                    <p className="text-sm font-semibold">Choose a model</p>
                    <p className="text-xs text-muted-foreground">Prices are per million tokens.</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fetchOpenRouterModels(openRouterApiKey)}
                    disabled={isFetchingOpenRouterModels || !openRouterApiKey.trim()}
                    className="liquid-button shrink-0 rounded-full"
                  >
                    {isFetchingOpenRouterModels ? (
                      <Loader2 className="h-4 w-4 animate-spin sm:mr-2" />
                    ) : null}
                    <span className="hidden sm:inline">Refresh</span>
                    <span className="sm:hidden">Reload</span>
                  </Button>
                </div>
                <Input
                  value={openRouterModelSearch}
                  onChange={(event) => setOpenRouterModelSearch(event.target.value)}
                  placeholder="Search models"
                  className="liquid-input mb-2 min-w-0 rounded-xl"
                />
                <div className="max-h-[min(60vh,30rem)] min-w-0 overflow-x-hidden overflow-y-auto rounded-2xl border border-white/45 bg-white/20 dark:border-white/10 dark:bg-black/10">
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
                            'flex w-full min-w-0 items-start justify-between gap-3 border-b border-white/30 px-4 py-3 text-left last:border-b-0 hover:bg-white/35 dark:border-white/10 dark:hover:bg-white/10',
                            isSelected && 'bg-white/45 dark:bg-white/10'
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <div className="min-w-0 truncate font-medium">{model.id}</div>
                              {model.architecture?.output_modalities?.includes('image') ? (
                                <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                                  Image
                                </span>
                              ) : null}
                              {model.architecture?.input_modalities?.includes('image') ? (
                                <span className="shrink-0 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-700 dark:text-violet-300">
                                  Vision
                                </span>
                              ) : null}
                              {model.architecture?.input_modalities?.includes('file') ? (
                                <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                                  Files
                                </span>
                              ) : null}
                            </div>
                            {model.name && model.name !== model.id ? (
                              <div className="truncate text-xs text-muted-foreground">{model.name}</div>
                            ) : null}
                            {inputPrice || outputPrice ? (
                              <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                                {inputPrice ? <span>In {inputPrice}</span> : null}
                                {outputPrice ? <span>Out {outputPrice}</span> : null}
                              </div>
                            ) : null}
                          </div>
                          {model.context_length ? (
                            <div className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                              {model.context_length.toLocaleString()} ctx
                            </div>
                          ) : null}
                        </button>
                      );
                    })
                  ) : (
                    <div className="px-4 py-7 text-center text-sm text-muted-foreground">
                      {openRouterApiKey.trim()
                        ? 'No models match your search.'
                        : 'Add an OpenRouter API key to load models.'}
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Response controls"
                  className="liquid-icon-button h-9 w-9 rounded-full"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="glass-dialog w-[min(92vw,22rem)] border-white/50 p-4 dark:border-white/10"
              >
                <div className="mb-4">
                  <p className="text-sm font-semibold">Response controls</p>
                  <p className="text-xs text-muted-foreground">Applied to your next message.</p>
                </div>
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1">
                      <Label htmlFor="navbar-web-search">Web search</Label>
                      <p className="text-xs leading-5 text-muted-foreground">Allow current web information.</p>
                    </div>
                    <Switch
                      id="navbar-web-search"
                      checked={webSearchEnabled}
                      onCheckedChange={setWebSearchEnabled}
                      aria-label="Enable web search"
                    />
                  </div>
                  <div className="space-y-2 border-t border-white/35 pt-4 dark:border-white/10">
                    <div className="space-y-1">
                      <Label htmlFor="navbar-reasoning-effort">Reasoning effort</Label>
                      <p className="text-xs leading-5 text-muted-foreground">
                        {selectedModelSupportsReasoningEffort
                          ? 'Higher effort can improve complex answers and increase output cost.'
                          : 'This model does not expose configurable reasoning levels.'}
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
                      <SelectTrigger id="navbar-reasoning-effort" className="liquid-input w-full rounded-xl">
                        <SelectValue placeholder="Model default" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">Model default</SelectItem>
                        {reasoningEffortOptions.map((effort) => (
                          <SelectItem key={effort} value={effort}>
                            {effort === 'xhigh' ? 'Extra high' : effort[0].toUpperCase() + effort.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

          <Button
            variant="outline"
            size="icon"
            onClick={() => setIsOpenRouterDialogOpen(true)}
            aria-label="OpenRouter settings"
            className="liquid-icon-button h-9 w-9 rounded-full"
          >
            <KeyRound className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={handleNewChat}
            aria-label="New Chat"
            className="liquid-icon-button h-9 w-9 rounded-full"
          >
            <Plus className="h-5 w-5" />
          </Button>
          <ThemeToggle />
        </div>
        </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        <ScrollArea ref={scrollAreaRef} className="h-full">
          <div className="mx-auto min-h-full w-full max-w-5xl space-y-6 px-4 py-6 md:px-8 md:py-10">
            {messages.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <Bot className="h-8 w-8" />
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">OpenRouter workspace</p>
                  <h2 className="text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">How can I help?</h2>
                  <p className="mx-auto max-w-md text-sm leading-6 text-muted-foreground">
                    Choose a model, bring your own key, and make something remarkable.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2 pt-2">
                  <span className="feature-pill">Private key storage</span>
                  <span className="feature-pill">Text &amp; image models</span>
                  <span className="feature-pill">Streaming replies</span>
                </div>
              </div>
            )}
            {messages.map((message, index) => (
              <div
                key={index}
                className={cn(
                  'flex items-start gap-3 animate-in fade-in duration-300',
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                {message.role === 'assistant' && (
                  <Avatar className="h-8 w-8 shrink-0 border">
                    <AvatarFallback>
                      <Bot className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                )}
                <div
                  className={cn(
                    'message-bubble max-w-[85%] p-4 text-[15px] leading-6 md:max-w-3xl',
                    message.role === 'user'
                      ? 'message-user'
                      : 'message-assistant'
                  )}
                >
                  <div className="flex flex-col gap-2">
                    {message.attachments && message.attachments.length > 0 ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {message.attachments.map((attachment) =>
                          attachment.kind === 'image' ? (
                            <div
                              key={attachment.id}
                              className="overflow-hidden rounded-2xl border border-white/30 bg-background/30 shadow-sm"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={attachment.dataUrl}
                                alt={attachment.name}
                                className="max-h-72 w-full object-contain"
                              />
                            </div>
                          ) : (
                            <div
                              key={attachment.id}
                              className="flex min-w-0 items-center gap-2 rounded-xl border border-white/30 bg-background/30 px-3 py-2 text-sm"
                            >
                              <FileText className="h-4 w-4 shrink-0" />
                              <span className="truncate">{attachment.name}</span>
                            </div>
                          )
                        )}
                      </div>
                    ) : null}
                    {message.images && message.images.length > 0 ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {message.images.map((image, imageIndex) => (
                          <div
                            key={`${image.url.slice(0, 32)}-${imageIndex}`}
                            className="overflow-hidden rounded-2xl border border-white/30 bg-background/30 shadow-sm"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={image.url}
                              alt={`Generated image ${imageIndex + 1}`}
                              className="h-auto w-full object-cover"
                            />
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      className="max-w-none"
                      components={{
                        p: ({ node, ...props }) => (
                          <p className="mb-2 last:mb-0" {...props} />
                        ),
                        ol: ({ node, ...props }) => (
                          <ol className="list-inside list-decimal" {...props} />
                        ),
                        ul: ({ node, ...props }) => (
                          <ul className="list-inside list-disc" {...props} />
                        ),
                        li: ({ node, ...props }) => <li className="mb-1" {...props} />,
                        code: ({ node, className, children, ...props }) =>
                          className ? (
                            <pre className="my-2 overflow-x-auto rounded-md bg-muted p-2">
                              <code className={className} {...props}>
                                {children}
                              </code>
                            </pre>
                          ) : (
                            <code
                              className="rounded-sm bg-muted px-1 py-0.5"
                              {...props}
                            >
                              {children}
                            </code>
                          ),
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                    {message.role === 'assistant' &&
                      message.content &&
                      (index < messages.length - 1 || !isLoading) && (
                        <div className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCopy(message.content)}
                              aria-label="Copy message"
                            className="h-7 w-7 rounded-full text-muted-foreground hover:bg-white/30"
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                  </div>
                </div>
                {message.role === 'user' && (
                  <Avatar className="h-8 w-8 shrink-0 border">
                    <AvatarFallback>
                      <User className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </main>

      <footer className="liquid-footer">
        <div className="mx-auto w-full max-w-4xl">
        {pendingAttachments.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2 px-1">
            {pendingAttachments.map((attachment) => (
              <div
                key={attachment.id}
                className="flex max-w-full items-center gap-2 rounded-xl border border-white/40 bg-white/35 px-2 py-1.5 text-xs shadow-sm backdrop-blur dark:border-white/10 dark:bg-black/20"
              >
                {attachment.kind === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={attachment.dataUrl}
                    alt=""
                    className="h-8 w-8 rounded-md object-cover"
                  />
                ) : (
                  <FileText className="h-4 w-4 shrink-0" />
                )}
                <span className="max-w-40 truncate">{attachment.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removePendingAttachment(attachment.id)}
                  className="h-6 w-6 shrink-0 rounded-full"
                  aria-label={`Remove ${attachment.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="composer-shell">
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
                    <div className="relative">
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
                        className="absolute left-2 top-1/2 z-10 h-10 w-10 -translate-y-1/2 rounded-full text-muted-foreground hover:bg-white/30"
                        aria-label="Add images or PDF documents"
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
                        <span className="sr-only">Add attachment</span>
                      </Button>
                      <Input
                        placeholder={
                          selectedModelSupportsAttachments
                            ? 'Ask about an image or PDF'
                            : 'Ask me anything'
                        }
                        autoComplete="off"
                        {...field}
                        disabled={isLoading || !selectedModel || !openRouterApiKey.trim()}
                        className="liquid-input h-14 rounded-[1.15rem] border-0 bg-transparent pl-14 pr-14 text-[15px] shadow-none focus-visible:ring-0"
                      />
                      {isLoading ? (
                        <Button
                          type="button"
                          size="icon"
                          onClick={handleStopGenerating}
                          className="absolute right-2 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full bg-destructive shadow-lg shadow-red-500/25 hover:bg-destructive/90"
                          aria-label="Stop generating"
                        >
                          <Square className="h-4 w-4" />
                          <span className="sr-only">Stop</span>
                        </Button>
                      ) : (
                        <Button
                          type="submit"
                          size="icon"
                          disabled={
                            (!field.value.trim() && pendingAttachments.length === 0) ||
                            !selectedModel ||
                            !openRouterApiKey.trim()
                          }
                          className="absolute right-2 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full bg-primary shadow-lg shadow-sky-500/30 hover:bg-primary/90"
                          aria-label="Send message"
                        >
                          <ArrowUp className="h-4 w-4" />
                          <span className="sr-only">Send</span>
                        </Button>
                      )}
                    </div>
                  </FormControl>
                </FormItem>
              )}
            />
          </form>
        </Form>
        <p className="mt-2 text-center text-[11px] text-muted-foreground/80">
          Responses can make mistakes. Check important information.
        </p>
        </div>
      </footer>

      <Dialog
        open={isOpenRouterDialogOpen}
        onOpenChange={setIsOpenRouterDialogOpen}
      >
        <DialogContent className="glass-dialog border-white/50 sm:max-w-md dark:border-white/10">
          <DialogHeader>
            <DialogTitle className="text-xl tracking-[-0.03em]">OpenRouter API key</DialogTitle>
            <DialogDescription>
              Your key is stored locally in this browser. Choose a model and response controls from the navbar.
            </DialogDescription>
          </DialogHeader>

          <div className="min-w-0">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="openrouter-api-key">API key</Label>
              <Input
                id="openrouter-api-key"
                type="password"
                value={openRouterApiKey}
                onChange={(event) => setOpenRouterApiKey(event.target.value)}
                placeholder="sk-or-v1-..."
                className="liquid-input min-w-0 rounded-xl"
              />
            </div>
          </div>

          <DialogFooter className="min-w-0">
            <Button type="button" onClick={handleSaveOpenRouterSettings} className="rounded-full px-5 shadow-lg shadow-sky-500/20">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
