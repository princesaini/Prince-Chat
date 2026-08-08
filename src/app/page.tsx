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
};

type OllamaModel = {
  name: string;
  modified_at: string;
  size: number;
};

type OpenRouterModel = {
  id: string;
  name: string;
  context_length?: number;
};

type Provider = 'ollama' | 'openrouter';

const formSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty.'),
});

const STORAGE_KEYS = {
  provider: 'prince-chat-provider',
  openRouterApiKey: 'prince-chat-openrouter-api-key',
  openRouterModel: 'prince-chat-openrouter-model',
  ollamaModel: 'prince-chat-ollama-model',
};

function parseOllamaChunk(
  chunk: string,
  appendAssistantText: (text: string) => void
) {
  const lines = chunk.split('\n').filter((line) => line.trim() !== '');

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.message?.content) {
        appendAssistantText(parsed.message.content);
      }
    } catch (error) {
      console.error('Error parsing Ollama streaming data:', error);
    }
  }
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
  const [provider, setProvider] = useState<Provider>('ollama');
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [selectedOllamaModel, setSelectedOllamaModel] = useState<string>('');
  const [openRouterModels, setOpenRouterModels] = useState<OpenRouterModel[]>([]);
  const [selectedOpenRouterModel, setSelectedOpenRouterModel] = useState<string>('');
  const [openRouterApiKey, setOpenRouterApiKey] = useState('');
  const [openRouterModelInput, setOpenRouterModelInput] = useState('');
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

  const selectedModel =
    provider === 'ollama' ? selectedOllamaModel : selectedOpenRouterModel;

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

  const fetchOllamaModels = async () => {
    try {
      const response = await fetch('/api/ollama/api/tags');
      if (!response.ok) {
        throw new Error('Failed to fetch models from Ollama.');
      }

      const data = await response.json();
      const fetchedModels = Array.isArray(data.models) ? data.models : [];
      setOllamaModels(fetchedModels);

      if (fetchedModels.length === 0) {
        setSelectedOllamaModel('');
        return;
      }

      setSelectedOllamaModel((currentModel) => {
        if (
          currentModel &&
          fetchedModels.some((model: OllamaModel) => model.name === currentModel)
        ) {
          return currentModel;
        }

        const storedModel = localStorage.getItem(STORAGE_KEYS.ollamaModel);
        if (
          storedModel &&
          fetchedModels.some((model: OllamaModel) => model.name === storedModel)
        ) {
          return storedModel;
        }

        return fetchedModels[0].name;
      });
    } catch (error) {
      console.error(error);
      toast({
        variant: 'destructive',
        title: 'Failed to fetch models.',
        description: 'Could not fetch models. Please ensure Ollama is running.',
      });
    }
  };

  const fetchOpenRouterModels = async (apiKey: string) => {
    if (!apiKey.trim()) {
      setOpenRouterModels([]);
      return;
    }

    setIsFetchingOpenRouterModels(true);

    try {
      const response = await fetch('/api/openrouter/api/v1/models', {
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
    fetchOllamaModels();

    const storedProvider = localStorage.getItem(STORAGE_KEYS.provider);
    const storedOpenRouterApiKey =
      localStorage.getItem(STORAGE_KEYS.openRouterApiKey) ?? '';
    const storedOpenRouterModel =
      localStorage.getItem(STORAGE_KEYS.openRouterModel) ?? '';

    if (storedProvider === 'ollama' || storedProvider === 'openrouter') {
      setProvider(storedProvider);
    }

    setOpenRouterApiKey(storedOpenRouterApiKey);
    setOpenRouterModelInput(storedOpenRouterModel);
    setSelectedOpenRouterModel(storedOpenRouterModel);

    if (storedOpenRouterApiKey) {
      void fetchOpenRouterModels(storedOpenRouterApiKey);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.provider, provider);
  }, [provider]);

  useEffect(() => {
    if (selectedOllamaModel) {
      localStorage.setItem(STORAGE_KEYS.ollamaModel, selectedOllamaModel);
    }
  }, [selectedOllamaModel]);

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
        description:
          provider === 'ollama'
            ? 'Please select an Ollama model first.'
            : 'Please enter or select an OpenRouter model first.',
      });
      return;
    }

    if (provider === 'openrouter' && !openRouterApiKey.trim()) {
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
      const endpoint =
        provider === 'ollama'
          ? '/api/ollama/api/chat'
          : '/api/openrouter/api/v1/chat/completions';

      const headers: HeadersInit =
        provider === 'openrouter'
          ? {
              'Content-Type': 'application/json',
              'x-openrouter-api-key': openRouterApiKey.trim(),
            }
          : {
              'Content-Type': 'application/json',
            };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
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

        if (provider === 'ollama') {
          parseOllamaChunk(chunk, appendAssistantText);
        } else {
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
          description:
            provider === 'ollama'
              ? "Failed to get a response from Ollama. Please ensure it's running."
              : 'Failed to get a response from OpenRouter. Check your API key and model.',
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
          <Select
            value={provider}
            onValueChange={(value) => setProvider(value as Provider)}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ollama">Ollama</SelectItem>
              <SelectItem value="openrouter">OpenRouter</SelectItem>
            </SelectContent>
          </Select>

          {provider === 'ollama' ? (
            <Select value={selectedOllamaModel} onValueChange={setSelectedOllamaModel}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Select an Ollama model" />
              </SelectTrigger>
              <SelectContent>
                {ollamaModels.map((model) => (
                  <SelectItem key={model.name} value={model.name}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="hidden md:flex items-center gap-2">
              <Input
                value={selectedOpenRouterModel}
                onChange={(event) => {
                  const value = event.target.value;
                  setSelectedOpenRouterModel(value);
                  setOpenRouterModelInput(value);
                }}
                placeholder="openai/gpt-4o-mini"
                className="w-[240px]"
              />
            </div>
          )}

          {provider === 'openrouter' && (
            <Button
              variant="outline"
              size="icon"
              onClick={() => setIsOpenRouterDialogOpen(true)}
              aria-label="OpenRouter settings"
            >
              <KeyRound className="h-4 w-4" />
            </Button>
          )}

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
                <p>
                  {provider === 'ollama'
                    ? 'Chat with your local Ollama models.'
                    : 'Chat with any OpenRouter model using your API key.'}
                </p>
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
                    'max-w-xs rounded-xl p-3 shadow-sm md:max-w-2xl',
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card'
                  )}
                >
                  <div className="flex flex-col gap-2">
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
        {provider === 'openrouter' && (
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
        )}

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
                        disabled={
                          isLoading ||
                          !selectedModel ||
                          (provider === 'openrouter' && !openRouterApiKey.trim())
                        }
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
                            !field.value ||
                            !selectedModel ||
                            (provider === 'openrouter' && !openRouterApiKey.trim())
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>OpenRouter settings</DialogTitle>
            <DialogDescription>
              Save your API key locally in this browser and choose any model slug.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="openrouter-api-key">API key</Label>
              <Input
                id="openrouter-api-key"
                type="password"
                value={openRouterApiKey}
                onChange={(event) => setOpenRouterApiKey(event.target.value)}
                placeholder="sk-or-v1-..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="openrouter-model">Model slug</Label>
              <Input
                id="openrouter-model"
                value={openRouterModelInput}
                onChange={(event) => setOpenRouterModelInput(event.target.value)}
                placeholder="anthropic/claude-3.5-sonnet"
              />
            </div>

            <div className="space-y-2">
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
              <Select
                value={selectedOpenRouterModel}
                onValueChange={(value) => {
                  setSelectedOpenRouterModel(value);
                  setOpenRouterModelInput(value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select an OpenRouter model" />
                </SelectTrigger>
                <SelectContent>
                  {openRouterModels.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" onClick={handleSaveOpenRouterSettings}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
