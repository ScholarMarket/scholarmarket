import { useEffect } from "react";

export default function useSearchShortcut(searchRef) {
  useEffect(() => {
    function focusSearch(event) {
      const target = event.target;
      if (event.key !== "/" || event.defaultPrevented || event.isComposing ||
          event.ctrlKey || event.metaKey || event.altKey ||
          target?.closest?.("input, textarea, select") || target?.isContentEditable ||
          target?.closest?.('[contenteditable]:not([contenteditable="false"])')) return;
      if (!searchRef.current) return;
      event.preventDefault();
      searchRef.current.focus();
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [searchRef]);
}
