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
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ArrowUp, Bot, Plus, User, Loader2 } from 'lucide-react';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

const formSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty.'),
});

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      message: '',
    },
  });
  
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

    const userInput = values.message;
    const newMessages: Message[] = [...messages, { role: 'user', content: userInput }];
    setMessages(newMessages);
    form.reset();
    setIsLoading(true);

    try {
      const response = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          model: 'llama3',
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
                if (lastMessage.role === 'assistant') {
                  lastMessage.content += parsed.message.content;
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
          "Failed to connect to Ollama. Ensure it's running on http://localhost:11434.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between p-4 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="w-8 h-8 text-primary" />
          <h1 className="text-xl font-semibold">Prince Chat</h1>
        </div>
        <Button variant="ghost" size="icon" onClick={handleNewChat} aria-label="New Chat">
          <Plus className="w-5 h-5" />
        </Button>
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
                  <Avatar className="w-8 h-8 border">
                    <AvatarFallback><Bot className="w-4 h-4" /></AvatarFallback>
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
                </div>
                {message.role === 'user' && (
                  <Avatar className="w-8 h-8 border">
                    <AvatarFallback><User className="w-4 h-4" /></AvatarFallback>
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
                        disabled={isLoading}
                        className="pr-12"
                      />
                      <Button
                        type="submit"
                        size="icon"
                        disabled={isLoading || !field.value}
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
