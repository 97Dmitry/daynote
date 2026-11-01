import * as Context from "@radix-ui/react-context-menu";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { useRef, type ReactElement } from "react";
export type MenuAction = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  opensDialog?: boolean;
};
function Items({
  items,
  context,
  selected,
}: {
  items: MenuAction[];
  context: boolean;
  selected: { current: boolean };
}) {
  const Item = context ? Context.Item : Dropdown.Item;
  return items.map((item) => (
    <Item
      key={item.label}
      className={`action-menu-item ${item.danger ? "danger" : ""}`}
      disabled={item.disabled}
      onSelect={() => {
        selected.current = !!item.opensDialog;
        item.onSelect();
      }}
    >
      {item.label}
    </Item>
  ));
}
export function ContextActions({
  children,
  items,
}: {
  children: ReactElement;
  items: MenuAction[];
}) {
  const selected = useRef(false);
  return (
    <Context.Root
      onOpenChange={(open) => {
        if (open) selected.current = false;
      }}
    >
      <Context.Trigger asChild>{children}</Context.Trigger>
      <Context.Portal>
        <Context.Content
          className="action-menu"
          collisionPadding={10}
          onCloseAutoFocus={(event) => {
            if (selected.current) event.preventDefault();
          }}
        >
          <Items items={items} context selected={selected} />
        </Context.Content>
      </Context.Portal>
    </Context.Root>
  );
}
export function ActionButton({ items, label }: { items: MenuAction[]; label: string }) {
  const selected = useRef(false);
  return (
    <Dropdown.Root
      onOpenChange={(open) => {
        if (open) selected.current = false;
      }}
    >
      <Dropdown.Trigger asChild>
        <button
          type="button"
          className="icon-button action-menu-trigger"
          aria-label={label}
          title={label}
        >
          <MoreHorizontal size={20} />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          className="action-menu"
          sideOffset={5}
          align="end"
          collisionPadding={10}
          onCloseAutoFocus={(event) => {
            if (selected.current) event.preventDefault();
          }}
        >
          <Items items={items} context={false} selected={selected} />
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
