import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', ...props }, ref) => {
    const variantStyles = {
      default: 'bg-slate-900 text-white hover:bg-slate-800 border border-slate-900',
      secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200 border border-slate-200',
      outline: 'bg-transparent text-slate-900 hover:bg-slate-50 border border-slate-300',
      ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 border border-transparent',
      destructive: 'bg-rose-600 text-white hover:bg-rose-700 border border-rose-600',
    };

    const sizeStyles = {
      sm: 'h-8 px-2.5 text-xs font-medium',
      md: 'h-9 px-3.5 text-sm font-medium',
      lg: 'h-10 px-5 text-sm font-semibold',
    };

    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-md transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1',
          'disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';
