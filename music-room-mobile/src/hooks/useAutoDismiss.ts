import { useEffect } from 'react';

// Each notification has its own timer; replacing or removing it cancels that timer.
export function useAutoDismiss(message: string, clear: (value: string) => void) {
  useEffect(() => {
    if (!message) return;
    const timeout = setTimeout(() => clear(''), 10_000);
    return () => clearTimeout(timeout);
  }, [message, clear]);
}
