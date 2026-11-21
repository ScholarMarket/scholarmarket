export default function HighlightedText({ text, query }) {
  const value = String(text ?? "");
  const term = String(query ?? "").trim();
  if (!term) return value;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = value.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, index) => index % 2 === 1
    ? <mark key={index}>{part}</mark>
    : part);
}
