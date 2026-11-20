import React from 'react';
import { cn } from '../../lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg' | 'icon';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          'inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap shrink-0 rounded-xl transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 disabled:opacity-50 disabled:pointer-events-none cursor-pointer active:scale-[0.98]',
          variant === 'primary' &&
            'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500',
          variant === 'secondary' &&
            'bg-[#EEF1F6] text-[#0F172A] hover:bg-[#E2E8F0] dark:bg-[#1A1F28] dark:text-[#F3F5F8] dark:hover:bg-[#242B38]',
          variant === 'outline' &&
            'border border-[#E2E8F0] bg-transparent text-[#0F172A] hover:bg-[#EEF1F6] dark:border-[#232936] dark:text-[#F3F5F8] dark:hover:bg-[#1A1F28]',
          variant === 'ghost' &&
            'bg-transparent text-[#475569] hover:bg-[#EEF1F6] hover:text-[#0F172A] dark:text-[#94A3B8] dark:hover:bg-[#1A1F28] dark:hover:text-[#F3F5F8]',
          variant === 'destructive' &&
            'bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500',
          size === 'sm' && 'min-h-[36px] px-3 py-1.5 text-xs',
          size === 'md' && 'min-h-[44px] px-4 py-2 text-sm',
          size === 'lg' && 'min-h-[48px] px-6 py-2.5 text-base',
          size === 'icon' && 'min-h-[44px] min-w-[44px] p-2',
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export const Surface: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => (
  <div
    className={cn(
      'rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] dark:border-[#232936] dark:bg-[#13161C]',
      className
    )}
    {...props}
  />
);

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'w-full min-h-[44px] rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3.5 py-2 text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-[#232936] dark:bg-[#0E1116] dark:text-[#F3F5F8] dark:placeholder:text-[#64748B]',
      className
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm leading-relaxed text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-[#232936] dark:bg-[#0E1116] dark:text-[#F3F5F8] dark:placeholder:text-[#64748B]',
      className
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  ariaLabel: string;
}

export const Switch: React.FC<SwitchProps> = ({ checked, onCheckedChange, ariaLabel }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    onClick={() => onCheckedChange(!checked)}
    className={cn(
      'relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
      checked ? 'bg-blue-600' : 'bg-[#CBD5E1] dark:bg-[#2B3242]'
    )}
  >
    <span
      className={cn(
        'pointer-events-none block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-150',
        checked ? '-translate-x-5' : 'translate-x-0'
      )}
    />
  </button>
);
