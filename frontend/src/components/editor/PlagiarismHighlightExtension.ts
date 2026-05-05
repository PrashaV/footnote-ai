// PlagiarismHighlightExtension — TipTap / ProseMirror plugin for plagiarism
// section highlights.
//
// Renders inline decorations (red underline + light red tint) on character
// ranges returned by the plagiarism check engine (Phase 4.4). Decorations are
// transient — they don't modify the document and are cleared automatically
// when results are reset.
//
// Usage in WorkspacePage:
//
//   1. Add PlagiarismHighlightExtension to the editor's extension list.
//   2. After receiving integrity results, dispatch flagged sections:
//
//        import { plagiarismHighlightKey } from './PlagiarismHighlightExtension'
//
//        editor.view.dispatch(
//          editor.view.state.tr.setMeta(plagiarismHighlightKey, {
//            sections: integrityResults.plagiarism_check.flagged_sections,
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
// walking text nodes in the document tree — identical to AIHighlightExtension.

import { Extension } from "@tiptap/core";
import { Decoration, DecorationSet } from "prosemirror-view";
import { Plugin, PluginKey } from "prosemirror-state";
import type { Node } from "prosemirror-model";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlagiarismFlaggedSection {
  start_char: number;
  end_char: number;
  reason: string;
}

interface PlagiarismHighlightState {
  sections: PlagiarismFlaggedSection[];
}

// ---------------------------------------------------------------------------
// Plugin key — used to dispatch updates from WorkspacePage
// ---------------------------------------------------------------------------

export const plagiarismHighlightKey = new PluginKey<PlagiarismHighlightState>(
  "plagiarismHighlight"
);

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

export const PlagiarismHighlightExtension = Extension.create({
  name: "plagiarismHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<PlagiarismHighlightState>({
        key: plagiarismHighlightKey,

        // ── State management ───────────────────────────────────────────────
        state: {
          init(): PlagiarismHighlightState {
            return { sections: [] };
          },

          apply(tr, prev): PlagiarismHighlightState {
            const meta = tr.getMeta(
              plagiarismHighlightKey
            ) as PlagiarismHighlightState | undefined;
            return meta !== undefined ? meta : prev;
          },
        },

        // ── Decoration rendering ───────────────────────────────────────────
        props: {
          decorations(state) {
            const pluginState = plagiarismHighlightKey.getState(state);
            if (!pluginState?.sections.length) return DecorationSet.empty;

            const decorations: Decoration[] = [];

            for (const section of pluginState.sections) {
              const from = textOffsetToDocPos(state.doc, section.start_char);
              const to = textOffsetToDocPos(state.doc, section.end_char);

              // Guard: skip invalid ranges
              if (from >= to || from < 0 || to > state.doc.content.size) continue;

              decorations.push(
                Decoration.inline(from, to, {
                  // Red underline + very light red tint so the text remains
                  // readable. Matches the "fail" color scheme used in the
                  // IntegritySidebar (red-400 / red-100).
                  style: [
                    "background-color: rgba(254, 202, 202, 0.35)", // red-200/35
                    "border-bottom: 2px solid rgba(239, 68, 68, 0.65)", // red-500/65
                    "border-radius: 2px",
                  ].join("; "),
                  title: section.reason, // tooltip on hover
                  "data-plagiarism-flagged": "true",
                })
              );
            }

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
