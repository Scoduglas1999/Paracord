import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { motion, HTMLMotionProps } from "framer-motion";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
    "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-semibold ring-offset-bg-primary transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 select-none",
    {
        variants: {
            variant: {
                default: "border border-white/10 bg-accent-primary text-white shadow-[0_8px_16px_rgba(111,134,255,0.25)] hover:-translate-y-0.5 hover:bg-accent-primary-hover hover:shadow-[0_12px_24px_rgba(111,134,255,0.35)]",
                destructive:
                    "border border-white/10 bg-accent-danger text-white shadow-[0_8px_16px_rgba(255,93,114,0.25)] hover:-translate-y-0.5 hover:bg-red-500 hover:shadow-[0_12px_24px_rgba(255,93,114,0.35)]",
                outline:
                    "border border-border-strong bg-bg-mod-subtle text-text-primary shadow-sm hover:bg-bg-mod-strong hover:border-border-glow",
                secondary:
                    "border border-white/10 bg-accent-success text-white shadow-[0_8px_16px_rgba(53,193,143,0.25)] hover:-translate-y-0.5 hover:bg-green-500 hover:shadow-[0_12px_24px_rgba(53,193,143,0.35)]",
                ghost: "border border-transparent text-text-secondary hover:border-border-subtle hover:bg-bg-mod-subtle hover:text-text-primary hover:shadow-sm",
                link: "text-text-link underline-offset-4 hover:underline",
            },
            size: {
                default: "h-10 px-4 py-2",
                sm: "h-9 px-3",
                lg: "h-11 px-8",
                icon: "h-10 w-10",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
);

export interface ButtonProps
    extends Omit<HTMLMotionProps<"button">, "ref">,
    VariantProps<typeof buttonVariants> {
    asChild?: boolean;
    loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, loading, children, disabled, ...props }, ref) => {
        return (
            <motion.button
                ref={ref}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.97 }}
                className={cn(buttonVariants({ variant, size, className }))}
                disabled={disabled || loading}
                {...props}
            >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {children as React.ReactNode}
            </motion.button>
        );
    }
);
Button.displayName = "Button";

export { Button, buttonVariants };
