"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="bottom-right"
      closeButton
      // Clear of the home indicator and the notch (viewport-fit=cover).
      offset={{ bottom: "max(24px, env(safe-area-inset-bottom))", right: "max(24px, env(safe-area-inset-right))" }}
      mobileOffset={{
        bottom: "max(16px, env(safe-area-inset-bottom))",
        left: "max(16px, env(safe-area-inset-left))",
        right: "max(16px, env(safe-area-inset-right))",
      }}
      containerAriaLabel="Notifications"
      toastOptions={{ closeButtonAriaLabel: "Fermer la notification" }}
      icons={{
        success: <CircleCheckIcon className="size-4 text-success" />,
        info: <InfoIcon className="size-4 text-info" />,
        warning: <TriangleAlertIcon className="size-4 text-warning" />,
        error: <OctagonXIcon className="size-4 text-destructive" />,
        loading: <Loader2Icon className="size-4 animate-spin text-muted-foreground" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          "--width": "min(360px, calc(100vw - 2rem))",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
