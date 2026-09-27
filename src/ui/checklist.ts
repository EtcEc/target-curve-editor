import type { ChecklistItem } from '../downloadSummary';

/** Fills `list` (a <ul class="checklist">) with one <li> per item; `on: false` items get the "off" style. */
export function renderChecklist(list: HTMLElement, items: readonly ChecklistItem[]): void {
  list.replaceChildren(
    ...items.map((item) => {
      const li = document.createElement('li');
      li.textContent = item.text;
      li.classList.toggle('off', !item.on);
      return li;
    })
  );
}
