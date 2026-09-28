// Runs before paint (via next/script's default strategy in the <head>)
// to apply the persisted theme immediately, avoiding a flash of the wrong
// theme. Keep this in sync with components/theme-toggle.tsx's storage key.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") {
      document.documentElement.setAttribute("data-theme", stored);
    }
  } catch (e) {}
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />;
}
