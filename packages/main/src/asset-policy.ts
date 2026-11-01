/** Closed packaged-resource paths; image directories never admit executable extensions. */
export function isRendererAssetPath(name: string): boolean {
  return /^(?:(?:assets\/)?[A-Za-z0-9_.-]+\.(?:html|js|css|woff2?|ttf|otf)|icons\/[a-z0-9-]+\.svg|branding\/(?:illustration\.(?:png|svg)|symbol\.svg))$/.test(
    name,
  );
}
