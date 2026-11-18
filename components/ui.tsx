import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

const buttonVariants = cva('button', {
  variants: { variant: { primary: 'primary', secondary: 'secondary', quiet: 'quiet' } },
  defaultVariants: { variant: 'secondary' },
})

export function Button({className,variant,asChild=false,...props}:ComponentProps<'button'> & VariantProps<typeof buttonVariants> & {asChild?:boolean}) {
  const Component = asChild ? Slot : 'button'
  return <Component data-slot="button" className={buttonVariants({variant,className})} {...props}/>
}
export function Panel({className='',...props}:ComponentProps<'section'>) {
  return <section className={`panel ${className}`} {...props}/>
}
export function Empty({children}:ComponentProps<'div'>) {
  return <div className="empty">{children}</div>
}
