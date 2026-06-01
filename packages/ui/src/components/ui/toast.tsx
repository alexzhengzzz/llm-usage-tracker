import * as React from 'react';
import { cn } from '@/lib/utils';

interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
  onClose?: () => void;
}

export function Toast({ message, type = 'info', onClose }: ToastProps) {
  React.useEffect(() => {
    if (onClose) {
      const timer = setTimeout(onClose, 3000);
      return () => clearTimeout(timer);
    }
  }, [onClose]);

  return (
    <div className={cn(
      'fixed bottom-4 right-4 p-4 rounded-lg shadow-lg',
      type === 'success' && 'bg-green-500 text-white',
      type === 'error' && 'bg-red-500 text-white',
      type === 'info' && 'bg-blue-500 text-white'
    )}>
      {message}
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = React.useState<ToastProps | null>(null);

  const showToast = (message: string, type?: 'success' | 'error' | 'info') => {
    setToast({ message, type, onClose: () => setToast(null) });
  };

  return { toast, showToast };
}