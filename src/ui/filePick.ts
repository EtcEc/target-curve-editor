/** Shows `name` in the `.file-name` label tied to input `#inputId` (for files that arrive by drag and drop). */
export function showFileName(inputId: string, name: string): void {
  const label = document.querySelector<HTMLElement>(`.file-name[data-for="${inputId}"]`);
  if (label) label.textContent = name;
}

/** Keeps every `.file-name[data-for]` label showing the file chosen in its input. */
export function bindFileNames(): void {
  document.querySelectorAll<HTMLElement>('.file-name[data-for]').forEach((label) => {
    const input = document.getElementById(label.dataset.for as string) as HTMLInputElement | null;
    input?.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) label.textContent = file.name;
    });
  });
}
