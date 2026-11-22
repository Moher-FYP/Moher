"use client";

import { Icon, quietButton } from "./kit";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={quietButton}>
      <Icon name="print" size={20} />
      Print or save as PDF
    </button>
  );
}
