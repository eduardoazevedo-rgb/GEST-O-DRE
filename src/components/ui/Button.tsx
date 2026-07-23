import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          // Estilo SalesGrid: cantos retos, uppercase, tracking largo, hover preto
          "inline-flex items-center justify-center gap-2 font-semibold uppercase tracking-widest shadow-sm transition ease-in-out duration-150 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed",
          {
            "bg-[var(--primary)] text-white hover:bg-black":
              variant === "primary",
            "bg-white text-gray-700 border border-gray-300 hover:border-black hover:text-black dark:bg-transparent dark:text-gray-200 dark:border-gray-600":
              variant === "secondary",
            "bg-red-600 text-white hover:bg-black":
              variant === "danger",
            "shadow-none text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-700":
              variant === "ghost",
          },
          {
            "h-9 px-4 text-[11px]": size === "sm",
            "h-10 px-5 text-xs": size === "md",
            "h-11 px-6 text-xs": size === "lg",
          },
          className
        )}
        {...props}
      >
        {loading && (
          <svg
            className="animate-spin h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
export default Button;
