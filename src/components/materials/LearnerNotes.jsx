"use client";

import { useState, useEffect } from "react";
import { useMaterialNote, useSaveMaterialNote } from "@/hooks/api/useMaterials";

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Sanitizes and renders markdown content into safe HTML.
 * Strips script tags, unsafe HTML elements, inline event handlers, and dangerous protocols.
 */
export function renderSanitizedMarkdown(content) {
  if (!content || typeof content !== "string") return "";

  // Normalize newlines
  let text = content.replace(/\r\n/g, "\n");

  // 1. Code blocks (fenced with ```) - extracted first and HTML-escaped so code samples render safely
  const codeBlocks = [];
  text = text.replace(/(?:^|\n)```([a-z0-9_-]*)\n([\s\S]*?)\n```/gi, (match, lang, code) => {
    const escaped = escapeHtml(code);
    codeBlocks.push(
      `<pre class="bg-gray-100 p-3 rounded-lg text-xs font-mono overflow-x-auto my-2 text-gray-800"><code>${escaped}</code></pre>`
    );
    return `\n%%CODEBLOCK${codeBlocks.length - 1}%%\n`;
  });

  // 2. Inline code (`code`) - extracted and HTML-escaped
  const inlineCodes = [];
  text = text.replace(/`([^`\n]+)`/g, (match, code) => {
    inlineCodes.push(
      `<code class="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono text-gray-800">${escapeHtml(code)}</code>`
    );
    return `%%INLINECODE${inlineCodes.length - 1}%%`;
  });

  // 3. Strip script tags and their contents completely (case-insensitive)
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");

  // 4. Strip dangerous embedding and form tags and their contents
  text = text.replace(
    /<(style|iframe|object|embed|applet|frameset|frame|meta|link|form|svg|math)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi,
    ""
  );
  // Also strip any remaining unclosed or self-closing dangerous tags
  text = text.replace(
    /<\/?(script|style|iframe|object|embed|applet|frameset|frame|meta|link|form|input|button|svg|math)\b[^>]*>/gi,
    ""
  );

  // 5. Strip all inline event handlers (onerror, onload, onclick, onmouseover, etc.)
  text = text.replace(/\s*on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // 6. Neutralize unsafe protocols (javascript:, vbscript:, data:) in existing HTML attributes
  text = text.replace(/(href|src)\s*=\s*(["'])\s*(?:javascript|vbscript|data):[\s\S]*?\2/gi, '$1="#"');
  text = text.replace(/(href|src)\s*=\s*(?:javascript|vbscript|data):[^\s>]+/gi, '$1="#"');

  // 7. Headings (h1 - h6)
  text = text.replace(/^#{6}\s+(.+)$/gm, '<h6 class="text-xs font-bold text-gray-900 mt-2 mb-1">$1</h6>');
  text = text.replace(/^#{5}\s+(.+)$/gm, '<h5 class="text-sm font-bold text-gray-900 mt-2 mb-1">$1</h5>');
  text = text.replace(/^#{4}\s+(.+)$/gm, '<h4 class="text-sm font-semibold text-gray-900 mt-2 mb-1">$1</h4>');
  text = text.replace(/^#{3}\s+(.+)$/gm, '<h3 class="text-base font-semibold text-gray-900 mt-3 mb-1">$1</h3>');
  text = text.replace(/^#{2}\s+(.+)$/gm, '<h2 class="text-lg font-bold text-gray-900 mt-3 mb-1.5">$1</h2>');
  text = text.replace(/^#{1}\s+(.+)$/gm, '<h1 class="text-xl font-bold text-gray-900 mt-4 mb-2">$1</h1>');

  // 8. Blockquotes
  text = text.replace(
    /^>\s+(.+)$/gm,
    '<blockquote class="border-l-4 border-gray-300 pl-3 my-2 text-gray-600 italic">$1</blockquote>'
  );

  // 9. Horizontal rules
  text = text.replace(/^(?:---|\*\*\*|___)\s*$/gm, '<hr class="my-3 border-gray-200" />');

  // 10. Lists
  text = text.replace(/^[\*\-]\s+(.+)$/gm, '<li class="ml-4 list-disc">$1</li>');
  text = text.replace(/^\d+\.\s+(.+)$/gm, '<li class="ml-4 list-decimal">$1</li>');

  // 11. Emphasis & Formatting
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  text = text.replace(/_([^_]+)_/g, '<em>$1</em>');
  text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // 12. Markdown links: [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
    const trimmed = url.trim();
    if (/^(?:javascript|vbscript|data):/i.test(trimmed)) {
      return linkText;
    }
    const safeUrl = escapeHtml(trimmed);
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline hover:text-blue-800">${linkText}</a>`;
  });

  // 13. Markdown images: ![alt](url)
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
    const trimmed = url.trim();
    if (/^(?:javascript|vbscript|data):/i.test(trimmed)) {
      return "";
    }
    const safeUrl = escapeHtml(trimmed);
    const safeAlt = escapeHtml(alt);
    return `<img src="${safeUrl}" alt="${safeAlt}" class="max-w-full h-auto rounded my-2" />`;
  });

  // 14. Paragraphs and line breaks
  const paragraphs = text.split(/\n\n+/);
  text = paragraphs
    .map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return "";
      if (/^(?:%%CODEBLOCK\d+%%|<(h[1-6]|hr|blockquote|li|pre|div|p)\b)/i.test(trimmed)) {
        return trimmed.replace(/\n/g, "<br />");
      }
      return `<p class="mb-2 leading-relaxed">${trimmed.replace(/\n/g, "<br />")}</p>`;
    })
    .filter(Boolean)
    .join("\n");

  // 15. Restore code blocks and inline code
  text = text.replace(/%%CODEBLOCK(\d+)%%/g, (_, index) => codeBlocks[Number(index)] || "");
  text = text.replace(/%%INLINECODE(\d+)%%/g, (_, index) => inlineCodes[Number(index)] || "");

  // 16. Final safety sweep for any raw unescaped script or event handler tags
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  text = text.replace(/<\/?script\b[^>]*>/gi, "");
  text = text.replace(/\s*on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  return text;
}

/**
 * LearnerNotes — personal notes saved per user per resource.
 * Notes are persisted via /api/materials/[id]/notes.
 */
export default function LearnerNotes({ materialId, walletAddress }) {
  const noteQuery = useMaterialNote(materialId, { enabled: !!walletAddress });
  const saveNote = useSaveMaterialNote(materialId);

  // A 404 just means no note exists yet.
  const loadError = noteQuery.error && noteQuery.error.status !== 404 ? noteQuery.error : null;
  const savedNote = noteQuery.isSuccess || noteQuery.error?.status === 404 ? noteQuery.data?.note ?? "" : null;

  // Local edits; `null` means "showing the saved value".
  const [draft, setDraft] = useState(null);
  const [activeTab, setActiveTab] = useState("write");
  const [lastSaved, setLastSaved] = useState(null);

  const note = draft ?? savedNote ?? "";
  const error = saveNote.error?.message || (loadError ? loadError.message || "Failed to load notes." : null);

  const isSavePending = (draft !== null && draft !== (savedNote ?? "")) || saveNote.isPending;

  // Autosave 1s after typing stops
  useEffect(() => {
    if (draft === null) return;
    if (draft === (savedNote ?? "")) return;

    const timer = setTimeout(() => {
      saveNote.mutate(draft, {
        onSuccess: () => {
          setDraft((current) => (current === draft ? null : current));
          setLastSaved(new Date());
        },
      });
    }, 1000);

    return () => clearTimeout(timer);
  }, [draft, savedNote, saveNote]);

  // Warn on beforeunload if a save is pending
  useEffect(() => {
    if (!isSavePending) return;

    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isSavePending]);

  function handleSave() {
    if (note === (savedNote ?? "") || saveNote.isPending) return;
    saveNote.mutate(note, {
      onSuccess: () => {
        setDraft((current) => (current === note ? null : current));
        setLastSaved(new Date());
      },
    });
  }

  if (noteQuery.isLoading) {
    return (
      <section
        aria-label="Your notes"
        className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm mt-10 animate-pulse h-40"
      />
    );
  }

  let statusText = null;
  if (saveNote.isPending) {
    statusText = "Saving…";
  } else if (draft !== null && draft !== (savedNote ?? "")) {
    statusText = "Unsaved changes";
  } else if (lastSaved !== null || (savedNote !== null && savedNote.trim())) {
    statusText = "Saved";
  } else if (savedNote !== null) {
    statusText = "No notes yet";
  }

  return (
    <section
      aria-label="Your notes"
      className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm mt-10"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Your Notes</h2>
        {statusText && (
          <p aria-live="polite" className="text-xs text-gray-400">
            {statusText}
          </p>
        )}
      </div>

      {!savedNote && !note.trim() && activeTab === "write" ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500 text-center mb-4">
          You haven&apos;t added any notes for this resource yet. Use the area below to jot down
          key takeaways or reminders.
        </div>
      ) : null}

      {/* Write / Preview Tab Header */}
      <div className="flex items-center space-x-1 border-b border-gray-200 mb-3" role="tablist" aria-label="Note editor tabs">
        <button
          type="button"
          role="tab"
          id="tab-write"
          aria-controls="panel-write"
          aria-selected={activeTab === "write"}
          onClick={() => setActiveTab("write")}
          className={`px-3 py-1.5 text-sm font-medium border-b-2 transition -mb-px ${
            activeTab === "write"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Write
        </button>
        <button
          type="button"
          role="tab"
          id="tab-preview"
          aria-controls="panel-preview"
          aria-selected={activeTab === "preview"}
          onClick={() => setActiveTab("preview")}
          className={`px-3 py-1.5 text-sm font-medium border-b-2 transition -mb-px ${
            activeTab === "preview"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Preview
        </button>
      </div>

      {/* Tab Panels */}
      {activeTab === "write" ? (
        <div id="panel-write" role="tabpanel" aria-labelledby="tab-write">
          <textarea
            value={note}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write your personal notes here…"
            rows={5}
            aria-label="Personal notes for this resource"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 placeholder:text-gray-400 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      ) : (
        <div id="panel-preview" role="tabpanel" aria-labelledby="tab-preview">
          {!note.trim() ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-sm text-gray-400 text-center">
              Nothing to preview.
            </div>
          ) : (
            <div
              aria-label="Notes preview"
              className="w-full min-h-[120px] rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 overflow-y-auto"
              dangerouslySetInnerHTML={{ __html: renderSanitizedMarkdown(note) }}
            />
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-3 flex items-center justify-between">
        <button
          onClick={handleSave}
          disabled={saveNote.isPending || note === (savedNote ?? "")}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {saveNote.isPending ? "Saving…" : "Save Notes"}
        </button>
        {savedNote && savedNote.trim() && (
          <p className="text-xs text-gray-400">Auto-saved per resource</p>
        )}
      </div>
    </section>
  );
}
