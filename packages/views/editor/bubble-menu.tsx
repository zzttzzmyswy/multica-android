"use client";

/**
 * EditorBubbleMenu — floating formatting toolbar for text selection.
 *
 * Positioned with @floating-ui/react-dom (useFloating + autoUpdate) and
 * portaled to document.body via createPortal. This escapes ALL overflow
 * containers in the ancestor chain (Card overflow:hidden, scrollable
 * containers, etc.) while autoUpdate monitors every ancestor scroll
 * container to keep the menu anchored to the selection.
 *
 * Previously used Tiptap's <BubbleMenu> component, but that plugin:
 * - only supports a single scrollTarget (misses nested scroll)
 * - shows the element before computing position (flash on first show)
 * - uses position:absolute which gets clipped by overflow:hidden
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/react-dom";
import { getOverflowAncestors } from "@floating-ui/dom";
import type { Editor } from "@tiptap/core";
import { posToDOMRect } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { Toggle } from "@multica/ui/components/ui/toggle";
import { Separator } from "@multica/ui/components/ui/separator";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@multica/ui/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@multica/ui/components/ui/dropdown-menu";
import { Input } from "@multica/ui/components/ui/input";
import { Button } from "@multica/ui/components/ui/button";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link2,
  List,
  ListOrdered,
  Quote,
  ChevronDown,
  Check,
  X,
  Unlink,
  Type,
  Heading1,
  Heading2,
  Heading3,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Visibility logic
// ---------------------------------------------------------------------------

function shouldShowBubbleMenu(editor: Editor): boolean {
  if (!editor.isEditable) return false;
  // Don't check hasFocus() here — it's unreliable during transaction events.
  // Focus loss is handled separately by the debounced blur handler.
  const { state } = editor;
  const { selection } = state;
  if (selection.empty) return false;
  const { from, to } = selection;
  if (!state.doc.textBetween(from, to).length) return false;
  if (selection instanceof NodeSelection) return false;
  const $from = state.doc.resolve(from);
  if ($from.parent.type.name === "codeBlock") return false;
  return true;
}

/** Detect macOS for keyboard shortcut labels */
const isMac =
  typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
const mod = isMac ? "\u2318" : "Ctrl";

// ---------------------------------------------------------------------------
// Mark Toggle Button
// ---------------------------------------------------------------------------

type InlineMark = "bold" | "italic" | "strike" | "code";

const toggleMarkActions: Record<InlineMark, (editor: Editor) => void> = {
  bold: (e) => e.chain().focus().toggleBold().run(),
  italic: (e) => e.chain().focus().toggleItalic().run(),
  strike: (e) => e.chain().focus().toggleStrike().run(),
  code: (e) => e.chain().focus().toggleCode().run(),
};

function MarkButton({
  editor,
  mark,
  icon: Icon,
  label,
  shortcut,
}: {
  editor: Editor;
  mark: InlineMark;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  shortcut: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            size="sm"
            pressed={editor.isActive(mark)}
            onPressedChange={() => toggleMarkActions[mark](editor)}
            onMouseDown={(e) => e.preventDefault()}
          />
        }
      >
        <Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {label}
        <span className="ml-1.5 text-muted-foreground">{shortcut}</span>
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// URL normalisation
// ---------------------------------------------------------------------------

/** Protocols that can execute code in the browser — the only ones we block. */
const DANGEROUS_PROTOCOL_RE = /^(javascript|data|vbscript):/i;
const HAS_PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:\/?\/?/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/")) return trimmed;
  if (DANGEROUS_PROTOCOL_RE.test(trimmed)) return "";
  if (HAS_PROTOCOL_RE.test(trimmed)) return trimmed;
  if (EMAIL_RE.test(trimmed)) return `mailto:${trimmed}`;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return `https://${trimmed}`;
}

// ---------------------------------------------------------------------------
// Link Edit Bar
// ---------------------------------------------------------------------------

function LinkEditBar({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const existingHref = editor.getAttributes("link").href as string | undefined;
  const [url, setUrl] = useState(existingHref ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const apply = useCallback(() => {
    const href = normalizeUrl(url);
    if (!href) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href })
        .run();
    }
    onClose();
  }, [editor, url, onClose]);

  const remove = useCallback(() => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    onClose();
  }, [editor, onClose]);

  return (
    <div
      className="bubble-menu-link-edit"
      onMouseDown={(e) => e.preventDefault()}
    >
      <Input
        ref={inputRef}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://..."
        aria-label="URL"
        className="h-7 flex-1 text-xs"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
            editor.commands.focus();
          }
        }}
      />
      <Button
        size="icon-xs"
        variant="ghost"
        onClick={apply}
        onMouseDown={(e) => e.preventDefault()}
      >
        <Check className="size-3.5" />
      </Button>
      {existingHref && (
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={remove}
          onMouseDown={(e) => e.preventDefault()}
        >
          <Unlink className="size-3.5" />
        </Button>
      )}
      <Button
        size="icon-xs"
        variant="ghost"
        onClick={() => {
          onClose();
          editor.commands.focus();
        }}
        onMouseDown={(e) => e.preventDefault()}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Heading Dropdown
// ---------------------------------------------------------------------------

function HeadingDropdown({
  editor,
  onOpenChange,
}: {
  editor: Editor;
  onOpenChange: (open: boolean) => void;
}) {
  const activeLevel = [1, 2, 3].find((l) =>
    editor.isActive("heading", { level: l }),
  );
  const label = activeLevel ? `H${activeLevel}` : "Text";
  const items = [
    { label: "Normal Text", icon: Type, active: !activeLevel, action: () => editor.chain().focus().setParagraph().run() },
    { label: "Heading 1", icon: Heading1, active: activeLevel === 1, action: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { label: "Heading 2", icon: Heading2, active: activeLevel === 2, action: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "Heading 3", icon: Heading3, active: activeLevel === 3, action: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
  ];

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        className="inline-flex h-7 items-center gap-0.5 rounded-md px-1.5 text-xs font-medium hover:bg-muted"
        onMouseDown={(e) => e.preventDefault()}
      >
        {label}
        <ChevronDown className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" sideOffset={8} align="start" className="w-auto">
        {items.map((item) => (
          <DropdownMenuItem key={item.label} onClick={item.action} className="gap-2 text-xs">
            <item.icon className="size-3.5" />
            {item.label}
            {item.active && <Check className="ml-auto size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// List Dropdown
// ---------------------------------------------------------------------------

function ListDropdown({
  editor,
  onOpenChange,
}: {
  editor: Editor;
  onOpenChange: (open: boolean) => void;
}) {
  const isBullet = editor.isActive("bulletList");
  const isOrdered = editor.isActive("orderedList");

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              className="inline-flex h-7 items-center gap-0.5 rounded-md px-1.5 text-xs font-medium hover:bg-muted aria-pressed:bg-muted"
              aria-pressed={isBullet || isOrdered}
              onMouseDown={(e) => e.preventDefault()}
            />
          }
        >
          <List className="size-3.5" />
          <ChevronDown className="size-3" />
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8}>List</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="bottom" sideOffset={8} align="start" className="w-auto">
        <DropdownMenuItem onClick={() => editor.chain().focus().toggleBulletList().run()} className="gap-2 text-xs">
          <List className="size-3.5" />
          Bullet List
          {isBullet && <Check className="ml-auto size-3.5" />}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().toggleOrderedList().run()} className="gap-2 text-xs">
          <ListOrdered className="size-3.5" />
          Ordered List
          {isOrdered && <Check className="ml-auto size-3.5" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Main Bubble Menu — useFloating + portal to body
// ---------------------------------------------------------------------------

function EditorBubbleMenu({ editor }: { editor: Editor }) {
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<"toolbar" | "link-edit">("toolbar");

  // Virtual reference that tracks the text selection.
  // contextElement tells autoUpdate where to find scroll ancestors.
  const virtualRef = useMemo(
    () => ({
      getBoundingClientRect: () => {
        const { from, to } = editor.state.selection;
        return posToDOMRect(editor.view, from, to);
      },
      contextElement: editor.view.dom,
    }),
    [editor],
  );

  const { refs, floatingStyles, isPositioned, update } = useFloating({
    strategy: "fixed",
    placement: "top",
    open: visible,
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    elements: { reference: virtualRef },
    whileElementsMounted: autoUpdate,
  });

  // Show/hide based on selection state — no blur/focus handling.
  useEffect(() => {
    const onTransaction = () => {
      const show = shouldShowBubbleMenu(editor);
      setVisible(show);
      // Must call update() manually — autoUpdate can't detect virtual
      // reference movement (it's not a real DOM element).
      if (show) update();
    };
    editor.on("transaction", onTransaction);
    return () => { editor.off("transaction", onTransaction); };
  }, [editor, update]);

  // Close on outside click (mousedown not in editor and not in menu)
  useEffect(() => {
    if (!visible) return;
    const handle = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (editor.view.dom.contains(target)) return;
      if (target.closest(".bubble-menu") || target.closest(".bubble-menu-link-edit")) return;
      setVisible(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [visible, editor]);

  // Close on any ancestor scroll or window resize
  useEffect(() => {
    if (!visible) return;
    const close = () => {
      setVisible(false);
    };
    const ancestors = getOverflowAncestors(editor.view.dom);
    ancestors.forEach((el) => el.addEventListener("scroll", close, { passive: true }));
    window.addEventListener("resize", close);
    return () => {
      ancestors.forEach((el) => el.removeEventListener("scroll", close));
      window.removeEventListener("resize", close);
    };
  }, [visible, editor]);

  // Reset mode on selection change
  useEffect(() => {
    const handler = () => setMode("toolbar");
    editor.on("selectionUpdate", handler);
    return () => { editor.off("selectionUpdate", handler); };
  }, [editor]);

  // Refocus editor when Base UI dropdown closes
  const handleMenuOpenChange = useCallback(
    (open: boolean) => { if (!open) editor.commands.focus(); },
    [editor],
  );

  const openLinkEdit = useCallback(() => setMode("link-edit"), []);
  const closeLinkEdit = useCallback(() => {
    setMode("toolbar");
    editor.commands.focus();
  }, [editor]);

  return createPortal(
    <div
      ref={refs.setFloating}
      style={{
        ...floatingStyles,
        zIndex: 50,
        // display:none when hidden — no residual animations from children.
        // Also hide until Floating UI has computed position (isPositioned)
        // to avoid a flash at top:0 left:0.
        display: visible && isPositioned ? undefined : "none",
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {mode === "link-edit" ? (
        <LinkEditBar editor={editor} onClose={closeLinkEdit} />
      ) : (
        <TooltipProvider delay={300}>
          <div className="bubble-menu">
            <MarkButton editor={editor} mark="bold" icon={Bold} label="Bold" shortcut={`${mod}+B`} />
            <MarkButton editor={editor} mark="italic" icon={Italic} label="Italic" shortcut={`${mod}+I`} />
            <MarkButton editor={editor} mark="strike" icon={Strikethrough} label="Strikethrough" shortcut={`${mod}+Shift+S`} />
            <MarkButton editor={editor} mark="code" icon={Code} label="Code" shortcut={`${mod}+E`} />

            <Separator orientation="vertical" className="mx-0.5 h-5" />

            <Tooltip>
              <TooltipTrigger
                render={
                  <Toggle
                    size="sm"
                    pressed={editor.isActive("link")}
                    onPressedChange={openLinkEdit}
                    onMouseDown={(e) => e.preventDefault()}
                  />
                }
              >
                <Link2 className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>Link</TooltipContent>
            </Tooltip>

            <Separator orientation="vertical" className="mx-0.5 h-5" />

            <HeadingDropdown editor={editor} onOpenChange={handleMenuOpenChange} />
            <ListDropdown editor={editor} onOpenChange={handleMenuOpenChange} />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Toggle
                    size="sm"
                    pressed={editor.isActive("blockquote")}
                    onPressedChange={() => editor.chain().focus().toggleBlockquote().run()}
                    onMouseDown={(e) => e.preventDefault()}
                  />
                }
              >
                <Quote className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>Quote</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      )}
    </div>,
    document.body,
  );
}

export { EditorBubbleMenu };
