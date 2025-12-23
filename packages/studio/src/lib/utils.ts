import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

export function formatTimestamp(timestamp: string | number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'active':
    case 'healthy':
    case 'completed':
      return 'bg-green-500';
    case 'idle':
    case 'pending':
      return 'bg-yellow-500';
    case 'failed':
    case 'error':
    case 'unhealthy':
      return 'bg-red-500';
    case 'evicted':
      return 'bg-gray-500';
    default:
      return 'bg-blue-500';
  }
}
