// ClaimHighlightExtension — TipTap / ProseMirror plugin for claim match
// inline decorations (Phase 4.5).
//
// Renders three visual styles based on the verdict encoded in the
// flagged_sections[].reason field by the backend:
//
//   reason prefix         visual style
//   ─────────────────     ──────────────────────────────────────────
//   "claim_entailed:"     subtle green left-border + pale green tint
//   "claim_unsupported:"  orange dashed underline
//   "claim_contradicted:" red solid underline + pale red tint
//
// Usage in WorkspacePage:
//
//   1. Add ClaimHighlightExtension to the editor's extension list.
//   2. After receiving integrity results, dispatch claim sections:
//
//        import { claimHighlightKey } from './ClaimHighlightExtension'
//
//        editor.view.dispatch(
//          editor.view.state.tr.setMeta(claimHighlightKey, {
//            sections: integrityResults.claim_match.flagged_sections,
//          })
//        )
//
//   3. To clear: dispatch with sections: []
//
// Character offset mapping
// ─────────────────────────
// Identical to AIHighlightExtension / PlagiarismHighlightExtension.
// The backend produces start_char / end_char into editor.getText('')
// (empty blockSeparator), and we convert via textOffsetToDocPos().

import { Extension } from "@tiptap/core";
import { Decoration, DecorationSet } from "prosemirror-view";
import { Plugin, PluginKey } from "prosemirror-state";
import type { Node } from "prosemirror-model";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClaimFlaggedSection {
  start_char: number;
  end_char: number;
  reason: string;  // "claim_entailed: …" | "claim_unsupported: …" | "claim_contradicted: …"
}

interface ClaimHighlightState {
  sections: ClaimFlaggedSection[];
}

// ---------------------------------------------------------------------------
// Plugin key
// ---------------------------------------------------------------------------

export const claimHighlightKey = new PluginKey<ClaimHighlightState>(
  "claimHighlight"
);

// ---------------------------------------------------------------------------
// Verdict extraction
// ---------------------------------------------------------------------------

type ClaimVerdict = "entailed" | "unsupported" | "contradicted" | null;

function extractVerdict(reason: string): ClaimVerdict {
  if (reason.startsWith("claim_entailed"))     return "entailed";
  if (reason.startsWith("claim_unsupported"))  return "unsupported";
  if (reason.startsWith("claim_contradicted")) return "contradicted";
  return null;
}

// ---------------------------------------------------------------------------
// Inline styles per verdict
// ---------------------------------------------------------------------------

const DECORATION_STYLES: Record<NonNullable<ClaimVerdict>, string[]> = {
  entailed: [
    "border-left: 3px solid rgba(34, 197, 94, 0.7)",   // green-500/70
    "padding-left: 3px",
    "background-color: rgba(220, 252, 231, 0.3)",      // green-100/30
    "border-radius: 2px",
  ],
  unsupported: [
    "border-bottom: 2px dashed rgba(249, 115, 22, 0.75)", // orange-500/75
    "border-radius: 2px",
  ],
  contradicted: [
    "background-color: rgba(254, 202, 202, 0.35)",  // red-200/35
    "border-bottom: 2px solid rgba(239, 68, 68, 0.75)", // red-500/75
    "border-radius: 2px",
  ],
};

const DATA_ATTRS: Record<NonNullable<ClaimVerdict>, string> = {
  entailed:     "entailed",
  unsupported:  "unsupported",
  contradicted: "contradicted",
};

// ---------------------------------------------------------------------------
// Character offset → ProseMirror document position
// (identical to PlagiarismHighlightExtension)
// ---------------------------------------------------------------------------

function textOffsetToDocPos(doc: Node, charOffset: number): number {
  if (charOffset <= 0) return 0;

  let textSeen = 0;
  let docPos = -1;

  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    if (docPos !== -1) return false;

    if (node.isText) {
      const nodeLen = node.text!.length;
      if (textSeen + nodeLen >= charOffset) {
        docPos = pos + (charOffset - textSeen);
        return false;
      }
      textSeen += nodeLen;
    }

    return true;
  });

  return docPos === -1 ? doc.content.size : docPos;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export const ClaimHighlightExtension = Extension.create({
  name: "claimHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<ClaimHighlightState>({
        key: claimHighlightKey,

        state: {
          init(): ClaimHighlightState {
            return { sections: [] };
          },

          apply(tr, prev): ClaimHighlightState {
            const meta = tr.getMeta(
              claimHighlightKey
            ) as ClaimHighlightState | undefined;
            return meta !== undefined ? meta : prev;
          },
        },

        props: {
          decorations(state) {
            const pluginState = claimHighlightKey.getState(state);
            if (!pluginState?.sections.length) return DecorationSet.empty;

            const decorations: Decoration[] = [];

            for (const section of pluginState.sections) {
              const verdict = extractVerdict(section.reason);
              if (!verdict) continue;

              const from = textOffsetToDocPos(state.doc, section.start_char);
              const to   = textOffsetToDocPos(state.doc, section.end_char);

              if (from >= to || from < 0 || to > state.doc.content.size) continue;

              const styles = DECORATION_STYLES[verdict];
              // Tooltip: strip the "claim_X: " prefix from reason
              const tooltip = section.reason.replace(/^claim_\w+:\s*/, "").trim();

              decorations.push(
                Decoration.inline(from, to, {
                  style: styles.join("; "),
                  title: tooltip || `Claim ${verdict}`,
                  "data-claim-verdict": DATA_ATTRS[verdict],
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
