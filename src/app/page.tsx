'use client';

import { useEffect, useRef, useState } from 'react';
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
  Copy,
  KeyRound,
  Loader2,
  Plus,
  Square,
  User,
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  images?: {
    url: string;
    mediaType: string;
  }[];
};

type OpenRouterModel = {
  id: string;
  name: string;
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
};

const formSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty.'),
});

const STORAGE_KEYS = {
  openRouterApiKey: 'prince-chat-openrouter-api-key',
  openRouterModel: 'prince-chat-openrouter-model',
};

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
  const [openRouterModelInput, setOpenRouterModelInput] = useState('');
  const [openRouterModelSearch, setOpenRouterModelSearch] = useState('');
  const [isOpenRouterDialogOpen, setIsOpenRouterDialogOpen] = useState(false);
  const [isFetchingOpenRouterModels, setIsFetchingOpenRouterModels] = useState(false);
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

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
      const response = await fetch('/api/openrouter/api/v1/models?output_modalities=all', {
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

    setOpenRouterApiKey(storedOpenRouterApiKey);
    setOpenRouterModelInput(storedOpenRouterModel);
    setSelectedOpenRouterModel(storedOpenRouterModel);

    if (storedOpenRouterApiKey) {
      void fetchOpenRouterModels(storedOpenRouterApiKey);
    }
  }, []);

  useEffect(() => {
    if (selectedOpenRouterModel) {
      localStorage.setItem(STORAGE_KEYS.openRouterModel, selectedOpenRouterModel);
      setOpenRouterModelInput(selectedOpenRouterModel);
    }
  }, [selectedOpenRouterModel]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleNewChat = () => {
    setMessages([]);
    form.reset();
  };

  const handleStopGenerating = () => {
    abortControllerRef.current?.abort();
  };

  const handleSaveOpenRouterSettings = async () => {
    const sanitizedApiKey = openRouterApiKey.trim();
    const sanitizedModel = openRouterModelInput.trim();

    localStorage.setItem(STORAGE_KEYS.openRouterApiKey, sanitizedApiKey);
    localStorage.setItem(STORAGE_KEYS.openRouterModel, sanitizedModel);

    setSelectedOpenRouterModel(sanitizedModel);
    setIsOpenRouterDialogOpen(false);

    if (sanitizedApiKey) {
      await fetchOpenRouterModels(sanitizedApiKey);
    } else {
      setOpenRouterModels([]);
    }

    toast({
      title: 'OpenRouter settings saved',
      description: 'Your API key and selected model are stored in this browser.',
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

    const userInput = values.message;
    const newMessages: Message[] = [
      ...messages,
      { role: 'user', content: userInput },
    ];

    setMessages(newMessages);
    form.reset();
    setIsLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      if (selectedModelOutputsImage) {
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
            messages: newMessages,
            stream: true,
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
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b p-4">
        <div className="flex items-center gap-2">
          <Bot className="h-8 w-8 text-primary" />
          <h1 className="text-xl font-semibold">Prince Chat</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 md:flex">
            <Input
              value={selectedOpenRouterModel}
              onChange={(event) => {
                const value = event.target.value;
                setSelectedOpenRouterModel(value);
                setOpenRouterModelInput(value);
              }}
              placeholder="openai/gpt-4o-mini"
              className="w-[260px]"
            />
          </div>

          <Button
            variant="outline"
            size="icon"
            onClick={() => setIsOpenRouterDialogOpen(true)}
            aria-label="OpenRouter settings"
          >
            <KeyRound className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={handleNewChat}
            aria-label="New Chat"
          >
            <Plus className="h-5 w-5" />
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="space-y-6 p-4 md:p-6">
            {messages.length === 0 && (
              <div className="flex h-[calc(100vh-150px)] flex-col items-center justify-center text-center text-muted-foreground">
                <Bot className="mb-4 h-16 w-16" />
                <h2 className="text-2xl font-semibold">Welcome to Prince Chat</h2>
                <p>Chat with any OpenRouter model using your API key.</p>
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
                    'max-w-xs rounded-xl p-3 shadow-sm md:max-w-3xl',
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card'
                  )}
                >
                  <div className="flex flex-col gap-2">
                    {message.images && message.images.length > 0 ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {message.images.map((image, imageIndex) => (
                          <div
                            key={`${image.url.slice(0, 32)}-${imageIndex}`}
                            className="overflow-hidden rounded-lg border bg-background"
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
                            className="h-6 w-6"
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
          <div ref={messagesEndRef} />
        </ScrollArea>
      </main>

      <footer className="shrink-0 border-t p-4">
        <div className="mb-3 rounded-lg border bg-muted/40 p-3 md:hidden">
          <Label htmlFor="mobile-openrouter-model">OpenRouter model</Label>
          <Input
            id="mobile-openrouter-model"
            value={selectedOpenRouterModel}
            onChange={(event) => {
              const value = event.target.value;
              setSelectedOpenRouterModel(value);
              setOpenRouterModelInput(value);
            }}
            placeholder="openai/gpt-4o-mini"
            className="mt-2"
          />
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex items-center gap-2">
            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormControl>
                    <div className="relative">
                      <Input
                        placeholder="Ask me anything"
                        autoComplete="off"
                        {...field}
                        disabled={isLoading || !selectedModel || !openRouterApiKey.trim()}
                        className="pr-12"
                      />
                      {isLoading ? (
                        <Button
                          type="button"
                          size="icon"
                          onClick={handleStopGenerating}
                          className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full bg-destructive hover:bg-destructive/90"
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
                            !field.value || !selectedModel || !openRouterApiKey.trim()
                          }
                          className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full bg-primary hover:bg-primary/90"
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
      </footer>

      <Dialog
        open={isOpenRouterDialogOpen}
        onOpenChange={setIsOpenRouterDialogOpen}
      >
        <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>OpenRouter settings</DialogTitle>
            <DialogDescription>
              Save your API key locally in this browser and choose any model slug.
            </DialogDescription>
          </DialogHeader>

          <div className="min-w-0 space-y-4 overflow-hidden">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="openrouter-api-key">API key</Label>
              <Input
                id="openrouter-api-key"
                type="password"
                value={openRouterApiKey}
                onChange={(event) => setOpenRouterApiKey(event.target.value)}
                placeholder="sk-or-v1-..."
                className="min-w-0"
              />
            </div>

            <div className="min-w-0 space-y-2">
              <Label htmlFor="openrouter-model">Model slug</Label>
              <Input
                id="openrouter-model"
                value={openRouterModelInput}
                onChange={(event) => setOpenRouterModelInput(event.target.value)}
                placeholder="anthropic/claude-3.5-sonnet"
                className="min-w-0"
              />
            </div>

            <div className="min-w-0 space-y-2 overflow-hidden">
              <div className="flex items-center justify-between">
                <Label>Available models</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fetchOpenRouterModels(openRouterApiKey)}
                  disabled={isFetchingOpenRouterModels || !openRouterApiKey.trim()}
                >
                  {isFetchingOpenRouterModels ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Refresh
                </Button>
              </div>
              <Input
                value={openRouterModelSearch}
                onChange={(event) => setOpenRouterModelSearch(event.target.value)}
                placeholder="Search models"
                className="min-w-0"
              />
              <div className="max-h-64 min-w-0 overflow-x-hidden overflow-y-auto rounded-md border">
                {filteredOpenRouterModels.length > 0 ? (
                  filteredOpenRouterModels.map((model) => {
                    const isSelected = model.id === selectedOpenRouterModel;

                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => {
                          setSelectedOpenRouterModel(model.id);
                          setOpenRouterModelInput(model.id);
                        }}
                        className={cn(
                          'flex w-full min-w-0 items-start justify-between gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/60',
                          isSelected && 'bg-muted'
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <div className="min-w-0 truncate font-medium">{model.id}</div>
                            {model.architecture?.output_modalities?.includes('image') ? (
                              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                                Image
                              </span>
                            ) : null}
                          </div>
                          {model.name && model.name !== model.id ? (
                            <div className="truncate text-xs text-muted-foreground">
                              {model.name}
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
                  <div className="px-3 py-6 text-sm text-muted-foreground">
                    No models match your search.
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="min-w-0">
            <Button type="button" onClick={handleSaveOpenRouterSettings}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
