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
import { Extension, mergeAttributes } from "@tiptap/core";
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

const LinkExtension = Link.configure({
  openOnClick: true,
  autolink: true,
  HTMLAttributes: {
    class: "text-primary hover:underline cursor-pointer",
  },
});

const MentionExtension = Mention.configure({
  HTMLAttributes: { class: "mention" },
  suggestion: createMentionSuggestion(),
}).extend({
  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(
        { "data-type": "mention" },
        this.options.HTMLAttributes,
        HTMLAttributes,
        {
          "data-mention-type": node.attrs.type ?? "member",
          "data-mention-id": node.attrs.id,
        },
      ),
      `@${node.attrs.label ?? node.attrs.id}`,
    ];
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      type: {
        default: "member",
        parseHTML: (el: HTMLElement) =>
          el.getAttribute("data-mention-type") ?? "member",
        renderHTML: () => ({}),
      },
    };
  },
  // @tiptap/markdown: custom tokenizer to parse [@Label](mention://type/id)
  markdownTokenizer: {
    name: "mention",
    level: "inline" as const,
    start(src: string) {
      return src.search(/\[@[^\]]+\]\(mention:\/\//);
    },
    tokenize(src: string) {
      const match = src.match(
        /^\[@([^\]]+)\]\(mention:\/\/(\w+)\/([^)]+)\)/,
      );
      if (!match) return undefined;
      return {
        type: "mention",
        raw: match[0],
        attributes: { label: match[1], type: match[2], id: match[3] },
      };
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parseMarkdown: (token: any, helpers: any) => {
    return helpers.createNode("mention", token.attributes);
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderMarkdown: (node: any) => {
    const { id, label, type = "member" } = node.attrs || {};
    return `[@${label ?? id}](mention://${type}/${id})`;
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

    // Keep refs in sync without recreating editor
    onUpdateRef.current = onUpdate;
    onSubmitRef.current = onSubmit;

    const editor = useEditor({
      immediatelyRender: false,
      editable,
      content: defaultValue || "",
      contentType: defaultValue ? "markdown" : undefined,
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
          onUpdateRef.current?.(ed.getMarkdown());
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
      getMarkdown: () => editor?.getMarkdown() ?? "",
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
