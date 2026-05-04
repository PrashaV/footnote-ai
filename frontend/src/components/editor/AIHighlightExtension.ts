// AIHighlightExtension — TipTap / ProseMirror plugin for AI sentence highlights.
//
// Renders inline decorations (amber background + underline) on character ranges
// returned by the AI detection engine. Decorations are transient — they don't
// modify the document and are cleared automatically when results are reset.
//
// Usage in WorkspacePage:
//
//   1. Add AIHighlightExtension to the editor's extension list.
//   2. After receiving integrity results, dispatch flagged sections:
//
//        import { aiHighlightKey } from './AIHighlightExtension'
//
//        editor.view.dispatch(
//          editor.view.state.tr.setMeta(aiHighlightKey, {
//            sections: integrityResults.ai_detection.flagged_sections,
//          })
//        )
//
//   3. To clear: dispatch with sections: []
//
// Character offset mapping
// ------------------------
// The backend returns start_char / end_char offsets into `editor.getText('')`
// (TipTap called with empty block separator so positions match ProseMirror's
// doc.textContent). The plugin converts these to ProseMirror positions by
// walking text nodes in the document tree.

import { Extension } from "@tiptap/core";
import { Decoration, DecorationSet } from "prosemirror-view";
import { Plugin, PluginKey } from "prosemirror-state";
import type { Node } from "prosemirror-model";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AIFlaggedSection {
  start_char: number;
  end_char: number;
  reason: string;
}

interface AIHighlightState {
  sections: AIFlaggedSection[];
}

// ---------------------------------------------------------------------------
// Plugin key — used to dispatch updates from WorkspacePage
// ---------------------------------------------------------------------------

export const aiHighlightKey = new PluginKey<AIHighlightState>("aiHighlight");

// ---------------------------------------------------------------------------
// Character offset → ProseMirror document position
// ---------------------------------------------------------------------------

/**
 * Map a plain-text character offset (from `editor.getText('')`) to a
 * ProseMirror document position.
 *
 * Walks text nodes in document order, accumulating text length seen so far.
 * When the target offset falls inside a text node, returns `nodePos + delta`.
 * Returns `doc.content.size` if the offset exceeds the document text length.
 */
function textOffsetToDocPos(doc: Node, charOffset: number): number {
  if (charOffset <= 0) return 0;

  let textSeen = 0;
  let docPos = -1;

  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    if (docPos !== -1) return false; // already found — stop walking

    if (node.isText) {
      const nodeLen = node.text!.length;
      if (textSeen + nodeLen >= charOffset) {
        docPos = pos + (charOffset - textSeen);
        return false;
      }
      textSeen += nodeLen;
    }

    return true; // continue walking
  });

  return docPos === -1 ? doc.content.size : docPos;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export const AIHighlightExtension = Extension.create({
  name: "aiHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<AIHighlightState>({
        key: aiHighlightKey,

        // ── State management ───────────────────────────────────────────────
        state: {
          init(): AIHighlightState {
            return { sections: [] };
          },

          apply(tr, prev): AIHighlightState {
            const meta = tr.getMeta(aiHighlightKey) as AIHighlightState | undefined;
            return meta !== undefined ? meta : prev;
          },
        },

        // ── Decoration rendering ───────────────────────────────────────────
        props: {
          decorations(state) {
            const pluginState = aiHighlightKey.getState(state);
            if (!pluginState?.sections.length) return DecorationSet.empty;

            const decorations: Decoration[] = [];

            for (const section of pluginState.sections) {
              const from = textOffsetToDocPos(state.doc, section.start_char);
              const to   = textOffsetToDocPos(state.doc, section.end_char);

              // Guard: skip invalid ranges
              if (from >= to || from < 0 || to > state.doc.content.size) continue;

              decorations.push(
                Decoration.inline(from, to, {
                  // Inline styles instead of a CSS class so we don't need a
                  // global stylesheet entry. Amber-200 at 40% opacity matches
                  // the green/yellow/red color scheme used in IntegritySidebar.
                  style: [
                    "background-color: rgba(253, 224, 71, 0.38)",     // amber-300/40
                    "border-bottom: 2px solid rgba(245, 158, 11, 0.55)", // amber-500/55
                    "border-radius: 2px",
                  ].join("; "),
                  title: section.reason, // tooltip on hover
                  "data-ai-flagged": "true",
                }),
              );
            }

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
