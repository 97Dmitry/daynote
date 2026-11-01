import * as Primitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
export function Dialog({
  title,
  children,
  onClose,
  session,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  session?: string;
}) {
  return (
    <Primitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Primitive.Portal>
        <Primitive.Overlay className="dialog-overlay" />
        <Primitive.Content
          className="dialog"
          aria-describedby={undefined}
          data-session={session}
        >
          <div className="dialog-heading">
            <Primitive.Title>{title}</Primitive.Title>
            <button
              type="button"
              className="icon-button"
              onClick={onClose}
              aria-label="Закрыть"
            >
              <X size={19} />
            </button>
          </div>
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
