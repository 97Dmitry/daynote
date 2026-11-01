import * as Primitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";
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
  const content = useRef<HTMLDivElement>(null);
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
          ref={content}
          className="dialog"
          aria-describedby={undefined}
          data-session={session}
          onOpenAutoFocus={(event) => {
            const field = content.current?.querySelector<HTMLElement>(
              'input:not(:disabled):not([type="hidden"]),textarea:not(:disabled)',
            );
            if (field) {
              event.preventDefault();
              field.focus();
            }
          }}
        >
          <div className="dialog-heading">
            <Primitive.Title>{title}</Primitive.Title>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть">
              <X size={19} />
            </button>
          </div>
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
