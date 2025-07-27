'use client'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface PrimaryButtonProps {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  size?: 'sm' | 'default' | 'lg'
  className?: string
  type?: 'button' | 'submit' | 'reset'
}

export function PrimaryButton({
  children,
  onClick,
  disabled = false,
  size = 'sm',
  className,
  type = 'button',
}: PrimaryButtonProps) {
  return (
    <Button
      type={type}
      onClick={onClick}
      disabled={disabled}
      size={size}
      className={cn(
        'flex items-center gap-1 bg-[#701FFC] font-[480] text-white shadow-[0_0_0_0_#701FFC] transition-all duration-200 hover:bg-[#6518E6] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
        disabled && 'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
    >
      {children}
    </Button>
  )
}
