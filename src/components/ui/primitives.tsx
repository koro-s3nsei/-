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
          'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
          variant === 'primary' &&
            'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500',
          variant === 'secondary' &&
            'bg-[#F3F4F6] text-[#111318] hover:bg-[#E5E7EB] dark:bg-[#191D26] dark:text-[#F4F5F7] dark:hover:bg-[#222836]',
          variant === 'outline' &&
            'border border-[#E5E7EB] bg-transparent text-[#111318] hover:bg-[#F3F4F6] dark:border-[#222630] dark:text-[#F4F5F7] dark:hover:bg-[#191D26]',
          variant === 'ghost' &&
            'bg-transparent text-[#4B5563] hover:bg-[#F3F4F6] hover:text-[#111318] dark:text-[#9CA3AF] dark:hover:bg-[#191D26] dark:hover:text-[#F4F5F7]',
          variant === 'destructive' &&
            'bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500',
          size === 'sm' && 'min-h-[36px] px-3 py-1.5 text-xs',
          size === 'md' && 'min-h-[42px] px-4 py-2 text-sm',
          size === 'lg' && 'min-h-[46px] px-5 py-2.5 text-sm',
          size === 'icon' && 'min-h-[40px] min-w-[40px] p-2',
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
      'rounded-2xl border border-[#E5E7EB] bg-white dark:border-[#222630] dark:bg-[#13151B]',
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
      'min-h-[42px] w-full rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] px-3.5 py-2 text-sm text-[#111318] placeholder:text-[#9CA3AF] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-[#222630] dark:bg-[#0E1015] dark:text-[#F4F5F7] dark:placeholder:text-[#6B7280]',
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
      'w-full rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] px-4 py-3 text-sm leading-relaxed text-[#111318] placeholder:text-[#9CA3AF] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-[#222630] dark:bg-[#0E1015] dark:text-[#F4F5F7] dark:placeholder:text-[#6B7280]',
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
      checked ? 'bg-blue-600' : 'bg-[#D1D5DB] dark:bg-[#2B3140]'
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
