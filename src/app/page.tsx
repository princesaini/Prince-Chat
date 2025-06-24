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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ArrowUp, Bot, Plus, User, Loader2, Copy } from 'lucide-react';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

type Model = {
  name: string;
  modified_at: string;
  size: number;
};

const formSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty.'),
});

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      message: '',
    },
  });

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await fetch('/api/ollama/api/tags');
        if (!response.ok) {
          throw new Error('Failed to fetch models from Ollama.');
        }
        const data = await response.json();
        setModels(data.models);
        if (data.models.length > 0) {
          setSelectedModel(data.models[0].name);
        }
      } catch (error) {
        console.error(error);
        toast({
          variant: 'destructive',
          title: 'Failed to fetch models.',
          description:
            "Could not fetch models. Please ensure Ollama is running.",
        });
      }
    };

    fetchModels();
  }, [toast]);
  
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleNewChat = () => {
    setMessages([]);
    form.reset();
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (isLoading) return;

    if (!selectedModel) {
      toast({
        variant: 'destructive',
        title: 'No model selected.',
        description: 'Please select a model from the dropdown first.',
      });
      return;
    }

    const userInput = values.message;
    const newMessages: Message[] = [...messages, { role: 'user', content: userInput }];
    setMessages(newMessages);
    form.reset();
    setIsLoading(true);

    try {
      const response = await fetch('/api/ollama/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          model: selectedModel,
          messages: newMessages,
          stream: true,
        }),
      });

      if (!response.body) {
        throw new Error('The response body is empty.');
      }
      
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter((line) => line.trim() !== '');

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.message?.content) {
              setMessages((prev) => {
                const updatedMessages = [...prev];
                const lastMessage = updatedMessages[updatedMessages.length - 1];
                if (lastMessage && lastMessage.role === 'assistant') {
                  updatedMessages[updatedMessages.length - 1] = {
                    ...lastMessage,
                    content: lastMessage.content + parsed.message.content,
                  };
                }
                return updatedMessages;
              });
            }
          } catch (e) {
            console.error('Error parsing streaming data:', e);
          }
        }
      }

    } catch (error) {
      setMessages((prev) => prev.slice(0, prev.length - 1));
      toast({
        variant: 'destructive',
        title: 'An error occurred.',
        description:
          "Failed to get a response from Ollama. Please ensure it's running.",
      });
    } finally {
      setIsLoading(false);
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
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between p-4 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="w-8 h-8 text-primary" />
          <h1 className="text-xl font-semibold">Prince Chat</h1>
        </div>
        <div className="flex items-center gap-4">
          {models.length > 0 && (
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {models.map((model) => (
                  <SelectItem key={model.name} value={model.name}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="ghost" size="icon" onClick={handleNewChat} aria-label="New Chat">
            <Plus className="w-5 h-5" />
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-4 md:p-6 space-y-6">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-[calc(100vh-150px)] text-center text-muted-foreground">
                  <Bot className="w-16 h-16 mb-4" />
                  <h2 className="text-2xl font-semibold">Welcome to Prince Chat</h2>
                  <p>Start a conversation by typing a message below.</p>
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
                  <Avatar className="w-8 h-8 border shrink-0">
                    <AvatarFallback>
                      <Bot className="w-4 h-4" />
                    </AvatarFallback>
                    
                  </Avatar>
                )}
                <div
                  className={cn(
                    'max-w-xs md:max-w-2xl p-3 rounded-xl shadow-sm',
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
                          p: ({node, ...props}) => <p className="mb-2 last:mb-0" {...props} />,
                          ol: ({node, ...props}) => <ol className="list-decimal list-inside" {...props} />,
                          ul: ({node, ...props}) => <ul className="list-disc list-inside" {...props} />,
                          li: ({node, ...props}) => <li className="mb-1" {...props} />,
                          code: ({node, inline, className, children, ...props}) => {
                            const match = /language-(\w+)/.exec(className || '')
                            return !inline ? (
                              <pre className="p-2 my-2 bg-muted rounded-md overflow-x-auto"><code className={className} {...props}>{children}</code></pre>
                            ) : (
                              <code className="px-1 py-0.5 bg-muted rounded-sm" {...props}>{children}</code>
                            )
                          }
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                    {message.role === 'assistant' && (
                      <div className="flex justify-end">
                         <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => handleCopy(message.content)}
                          aria-label="Copy message"
                          className="w-6 h-6"
                         >
                            <Copy className="w-3 h-3" />
                         </Button>
                      </div>
                    )}
                  </div>
                </div>
                {message.role === 'user' && (
                  <Avatar className="w-8 h-8 border shrink-0">
                    <AvatarFallback>
                      <User className="w-4 h-4" />
                    </AvatarFallback>
                  </Avatar>
                )}
              </div>
            ))}
          </div>
          <div ref={messagesEndRef} />
        </ScrollArea>
      </main>
      
      <footer className="p-4 border-t shrink-0">
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
                        placeholder="Type a message..."
                        autoComplete="off"
                        {...field}
                        disabled={isLoading || !selectedModel}
                        className="pr-12"
                      />
                      <Button
                        type="submit"
                        size="icon"
                        disabled={isLoading || !field.value || !selectedModel}
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-accent hover:bg-accent/90"
                      >
                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                        <span className="sr-only">Send</span>
                      </Button>
                    </div>
                  </FormControl>
                </FormItem>
              )}
            />
          </form>
        </Form>
      </footer>
    </div>
  );
}
