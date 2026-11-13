'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ScrollToBottomButtonProps {
  scrollAreaRef: React.RefObject<HTMLDivElement>;
}

export function ScrollToBottomButton({ scrollAreaRef }: ScrollToBottomButtonProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLDivElement>(
      '[data-radix-scroll-area-viewport]'
    );
    if (!viewport) return;

    let rafId: number | null = null;
    const handleScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const distanceFromBottom =
          viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
        setShow(distanceFromBottom > 140);
      });
    };

    viewport.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      viewport.removeEventListener('scroll', handleScroll);
    };
  }, [scrollAreaRef]);

  const scrollToBottom = useCallback(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLDivElement>(
      '[data-radix-scroll-area-viewport]'
    );
    viewport?.scrollTo({
      top: viewport.scrollHeight,
      behavior: 'smooth',
    });
  }, [scrollAreaRef]);

  if (!show) return null;

  return (
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
  );
}
