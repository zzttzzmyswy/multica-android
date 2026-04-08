"use client";

/**
 * ReadonlyContent — lightweight markdown renderer for readonly content display.
 *
 * Replaces <ContentEditor editable={false}> for comment cards and other
 * read-only surfaces. Uses react-markdown instead of a full Tiptap/ProseMirror
 * instance, eliminating EditorView, Plugin, and NodeView overhead.
 *
 * Visual parity with ContentEditor is achieved by:
 * - Wrapping output in <div class="rich-text-editor readonly"> so the same
 *   content-editor.css rules apply to standard HTML tags
 * - Using the same preprocessMarkdown pipeline (mention shortcodes + linkify)
 * - Using lowlight for code highlighting (same engine as Tiptap's CodeBlockLowlight)
 *   so .hljs-* CSS rules from content-editor.css produce identical colors
 * - Rendering mentions with the same IssueMentionCard component and .mention class
 */

import { useMemo } from "react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { createLowlight, common } from "lowlight";
import { toHtml } from "hast-util-to-html";
import { cn } from "@/lib/utils";
import { IssueMentionCard } from "@/features/issues/components/issue-mention-card";
import { preprocessMarkdown } from "./utils/preprocess";
import "./content-editor.css";

// ---------------------------------------------------------------------------
// Lowlight — same engine + language set as Tiptap's CodeBlockLowlight
// ---------------------------------------------------------------------------

const lowlight = createLowlight(common);

// ---------------------------------------------------------------------------
// URL transform — allow mention:// protocol through react-markdown's sanitizer
// ---------------------------------------------------------------------------

function urlTransform(url: string): string {
  if (url.startsWith("mention://")) return url;
  return defaultUrlTransform(url);
}

// ---------------------------------------------------------------------------
// Custom react-markdown components
// ---------------------------------------------------------------------------

const components: Partial<Components> = {
  // Links — route mention:// to mention components, others open in new tab
  a: ({ href, children }) => {
    if (href?.startsWith("mention://")) {
      const match = href.match(
        /^mention:\/\/(member|agent|issue|all)\/(.+)$/,
      );
      if (match?.[1] === "issue" && match[2]) {
        const label =
          typeof children === "string"
            ? children
            : Array.isArray(children)
              ? children.join("")
              : undefined;
        // Wrap in inline span for vertical alignment (mimics Tiptap's NodeViewWrapper)
        return (
          <span
            className="inline align-middle"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(`/issues/${match[2]}`, "_blank", "noopener,noreferrer");
            }}
          >
            <IssueMentionCard issueId={match[2]} fallbackLabel={label} />
          </span>
        );
      }
      // Member / agent / all mentions
      return <span className="mention">{children}</span>;
    }

    // Regular links — open in new tab (matches ContentEditor readonly behavior)
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          if (href) window.open(href, "_blank", "noopener,noreferrer");
        }}
      >
        {children}
      </a>
    );
  },

  // Images — constrain width (matches Tiptap Image extension inline style)
  img: ({ src, alt, ...props }) => (
    <img
      src={src}
      alt={alt ?? ""}
      style={{ maxWidth: "100%", height: "auto" }}
      {...props}
    />
  ),

  // Tables — wrap in tableWrapper div for border/radius/scroll (matches Tiptap)
  table: ({ children }) => (
    <div className="tableWrapper">
      <table>{children}</table>
    </div>
  ),

  // Code — lowlight highlighting for blocks, plain render for inline
  code: ({ className, children, node, ...props }) => {
    const lang = /language-(\w+)/.exec(className || "")?.[1];
    const isBlock =
      node?.position &&
      node.position.start.line !== node.position.end.line;

    if (!isBlock && !lang) {
      // Inline code — CSS handles styling via .rich-text-editor code
      return <code {...props}>{children}</code>;
    }

    // Block code — highlight with lowlight, output hljs classes
    const code = String(children).replace(/\n$/, "");
    try {
      const tree = lang
        ? lowlight.highlight(lang, code)
        : lowlight.highlightAuto(code);
      return (
        <code
          className={cn("hljs", lang && `language-${lang}`)}
          dangerouslySetInnerHTML={{ __html: toHtml(tree) }}
        />
      );
    } catch {
      // Fallback — render without highlighting
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
  },

  // Pre — pass through (CSS handles styling via .rich-text-editor pre)
  pre: ({ children }) => <pre>{children}</pre>,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ReadonlyContentProps {
  content: string;
  className?: string;
}

export function ReadonlyContent({ content, className }: ReadonlyContentProps) {
  const processed = useMemo(() => preprocessMarkdown(content), [content]);

  return (
    <div className={cn("rich-text-editor readonly text-sm", className)}>
      <ReactMarkdown
        remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
        rehypePlugins={[rehypeRaw]}
        urlTransform={urlTransform}
        components={components}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
