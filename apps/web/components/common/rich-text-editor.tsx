"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Typography from "@tiptap/extension-typography";
import Mention from "@tiptap/extension-mention";
import { Markdown } from "@tiptap/markdown";
import { Extension } from "@tiptap/core";
import { cn } from "@/lib/utils";
import { createMentionSuggestion } from "./mention-suggestion";
import "./rich-text-editor.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RichTextEditorProps {
  defaultValue?: string;
  onUpdate?: (markdown: string) => void;
  placeholder?: string;
  editable?: boolean;
  className?: string;
  debounceMs?: number;
  onSubmit?: () => void;
}

interface RichTextEditorRef {
  getMarkdown: () => string;
  clearContent: () => void;
  focus: () => void;
}

// ---------------------------------------------------------------------------
// Submit shortcut extension (Mod+Enter)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mention extension configured for markdown serialization
// Stores as: [@Label](mention://type/id)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Link extension — always serialize as [text](url), never <url> autolinks;
// support Cmd+Click / Ctrl+Click to open in new tab.
// ---------------------------------------------------------------------------

const LinkExtension = Link.configure({
  openOnClick: true,
  autolink: true,
  HTMLAttributes: {
    class: "text-primary hover:underline cursor-pointer",
  },
}).extend({
  addStorage() {
    return {
      markdown: {
        serialize: {
          open() {
            return "[";
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          close(_state: any, mark: any) {
            const href = (mark.attrs.href as string).replace(/[\(\)"]/g, "\\$&");
            const title = mark.attrs.title
              ? ` "${(mark.attrs.title as string).replace(/"/g, '\\"')}"`
              : "";
            return `](${href}${title})`;
          },
          mixable: true,
        },
        parse: {},
      },
    };
  },
});

const MentionExtension = Mention.configure({
  HTMLAttributes: { class: "mention" },
  suggestion: createMentionSuggestion(),
}).extend({
  renderHTML({ node, HTMLAttributes }) {
    const type = node.attrs.type ?? "member";
    const label = node.attrs.label ?? node.attrs.id;
    return [
      "a",
      {
        ...HTMLAttributes,
        href: `mention://${type}/${node.attrs.id}`,
        "data-mention-type": type,
        "data-mention-id": node.attrs.id,
      },
      type === "issue" ? label : `@${label}`,
    ];
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      type: {
        default: "member",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-mention-type") ?? "member",
      },
      description: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-mention-description"),
      },
    };
  },
  // @tiptap/markdown 3.x uses renderMarkdown as a top-level extension field
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderMarkdown(node: any) {
    const type = node.attrs?.type ?? "member";
    const label = node.attrs?.label ?? node.attrs?.id;
    const display = type === "issue" ? label : `@${label}`;
    return `[${display}](mention://${type}/${node.attrs?.id})`;
  },
});

// ---------------------------------------------------------------------------
// Submit shortcut extension (Mod+Enter)
// ---------------------------------------------------------------------------

function createSubmitExtension(onSubmit: () => void) {
  return Extension.create({
    name: "submitShortcut",
    addKeyboardShortcuts() {
      return {
        "Mod-Enter": () => {
          onSubmit();
          return true;
        },
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const RichTextEditor = forwardRef<RichTextEditorRef, RichTextEditorProps>(
  function RichTextEditor(
    {
      defaultValue = "",
      onUpdate,
      placeholder: placeholderText = "",
      editable = true,
      className,
      debounceMs = 300,
      onSubmit,
    },
    ref,
  ) {
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const onUpdateRef = useRef(onUpdate);
    const onSubmitRef = useRef(onSubmit);

    // Helper to get markdown from @tiptap/markdown extension.
    // Post-processes mention shortcodes [@ id="..." label="..."] → markdown
    // links, using the Tiptap JSON doc for type info, in case the
    // renderMarkdown override doesn't take effect.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getEditorMarkdown = (ed: any): string => {
      const md: string = ed?.getMarkdown?.() ?? "";
      if (!md || !md.includes("[@ ")) return md;

      // Build type map from editor JSON (which always has the type attr)
      const json = ed?.getJSON?.();
      const typeMap = new Map<string, string>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function walk(node: any) {
        if (node?.type === "mention" && node.attrs?.id) {
          typeMap.set(node.attrs.id, node.attrs.type || "member");
        }
        if (node?.content) node.content.forEach(walk);
      }
      if (json) walk(json);

      return md.replace(
        /\[@\s+([^\]]*)\]/g,
        (match: string, attrString: string) => {
          const attrs: Record<string, string> = {};
          const re = /(\w+)="([^"]*)"/g;
          let m;
          while ((m = re.exec(attrString)) !== null) {
            if (m[1] && m[2] !== undefined) attrs[m[1]] = m[2];
          }
          const { id, label } = attrs;
          if (!id || !label) return match;
          const type = typeMap.get(id) || "member";
          const display = type === "issue" ? label : `@${label}`;
          return `[${display}](mention://${type}/${id})`;
        },
      );
    };

    // Keep refs in sync without recreating editor
    onUpdateRef.current = onUpdate;
    onSubmitRef.current = onSubmit;

    const editor = useEditor({
      immediatelyRender: false,
      editable,
      content: defaultValue,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          link: false,
        }),
        Placeholder.configure({
          placeholder: placeholderText,
        }),
        LinkExtension,
        Typography,
        MentionExtension,
        Markdown,
        createSubmitExtension(() => onSubmitRef.current?.()),
      ],
      onUpdate: ({ editor: ed }) => {
        if (!onUpdateRef.current) return;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          onUpdateRef.current?.(getEditorMarkdown(ed));
        }, debounceMs);
      },
      editorProps: {
        handleDOMEvents: {
          click(_view, event) {
            if (event.metaKey || event.ctrlKey) {
              const link = (event.target as HTMLElement).closest("a");
              const href = link?.getAttribute("href");
              if (href && !href.startsWith("mention://")) {
                window.open(href, "_blank", "noopener,noreferrer");
                event.preventDefault();
                return true;
              }
            }
            return false;
          },
        },
        attributes: {
          class: cn("rich-text-editor text-sm outline-none", className),
        },
      },
    });

    // Cleanup debounce on unmount
    useEffect(() => {
      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }, []);

    useImperativeHandle(ref, () => ({
      getMarkdown: () => getEditorMarkdown(editor),
      clearContent: () => {
        editor?.commands.clearContent();
      },
      focus: () => {
        editor?.commands.focus();
      },
    }));

    if (!editor) return null;

    return <EditorContent editor={editor} />;
  },
);

export { RichTextEditor, type RichTextEditorProps, type RichTextEditorRef };
