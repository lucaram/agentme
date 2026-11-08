"use client";

export function PrintButton() {
  return (
    <button type="button" className="rounded-full bg-black px-5 py-2 text-sm font-semibold text-white" onClick={() => window.print()}>
      🖨️ Print
    </button>
  );
}
