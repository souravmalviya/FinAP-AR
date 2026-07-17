// The Verity brand mark - the real artwork file, not drawn in code.
// The image lives in web/public/logo.png (Next serves public/ at the site
// root, so "/logo.png" just works) and the same artwork is app/icon.png,
// which Next picks up automatically as the browser favicon.
// Rebranding = replace those two files. No code changes.
export default function Logo({ size = 30 }: { size?: number }) {
  return (
    <img src="/logo.png" width={size} height={size} alt="Verity logo" style={{ display: "block" }} />
  );
}
