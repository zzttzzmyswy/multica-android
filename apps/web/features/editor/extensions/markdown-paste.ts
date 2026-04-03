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
            clipboardTextParser(text, _context, plainText) {
              if (!plainText && editor.markdown) {
                const json = editor.markdown.parse(text);
                const node = editor.schema.nodeFromJSON(json);
                return Slice.maxOpen(node.content);
              }
              // Plain text fallback
              const p = editor.schema.nodes.paragraph!;
              const doc = editor.schema.nodes.doc!;
              const paragraph = p.create(null, text ? editor.schema.text(text) : undefined);
              return new Slice(doc.create(null, paragraph).content, 0, 0);
            },
          },
        }),
      ];
    },
  });
}
