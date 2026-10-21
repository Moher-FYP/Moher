"use client";

import { primaryButton } from "./ui";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={primaryButton}>
      Print or save as PDF
    </button>
  );
}
