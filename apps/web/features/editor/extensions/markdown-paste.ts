import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Slice } from "@tiptap/pm/model";

export function createMarkdownPasteExtension() {
  return Extension.create({
    name: "markdownPaste",
    addProseMirrorPlugins() {
      const { editor } = this;
      return [
        new Plugin({
          key: new PluginKey("markdownPaste"),
          props: {
            handlePaste(view, event) {
              if (!editor.markdown) return false;
              const clipboard = event.clipboardData;
              if (!clipboard) return false;

              const text = clipboard.getData("text/plain");
              if (!text) return false;

              const html = clipboard.getData("text/html");

              // If HTML contains data-pm-slice, the source is another
              // ProseMirror editor — let ProseMirror use its native HTML
              // clipboard path to preserve exact node structure.
              if (html && html.includes("data-pm-slice")) return false;

              // Everything else (VS Code, text editors, .md files, terminals,
              // web pages): parse text/plain as Markdown.
              const json = editor.markdown.parse(text);
              const node = editor.schema.nodeFromJSON(json);
              const slice = Slice.maxOpen(node.content);
              const tr = view.state.tr.replaceSelection(slice);
              view.dispatch(tr);
              return true;
            },
          },
        }),
      ];
    },
  });
}
