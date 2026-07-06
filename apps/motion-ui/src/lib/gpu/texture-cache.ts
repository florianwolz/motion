/**
 * gpu/texture-cache.ts — Asynchronous GPU texture cache for image/video nodes.
 *
 * Images are fetched once and kept as GPU textures.  The first time an image
 * is requested the fetch is kicked off in the background; subsequent frames
 * return the cached texture (or null while loading).
 */

type CacheEntry = GPUTexture | "loading" | "error";

export class TextureCache {
  private readonly cache = new Map<string, CacheEntry>();
  /** Whether any texture completed loading since the last flush call. */
  hasNewTextures = false;

  /**
   * Return the cached GPUTexture for `uri`, or `null` if it is not yet ready.
   *
   * Side-effect: starts an async load if the URI has not been seen before.
   */
  get(uri: string, device: GPUDevice, queue: GPUQueue): GPUTexture | null {
    const entry = this.cache.get(uri);
    if (entry instanceof GPUTexture) return entry;
    if (entry === "loading" || entry === "error") return null;

    // First request: start async load
    this.cache.set(uri, "loading");
    void this.loadAsync(uri, device, queue);
    return null;
  }

  private async loadAsync(uri: string, device: GPUDevice, queue: GPUQueue): Promise<void> {
    try {
      let bitmap: ImageBitmap;
      if (uri.startsWith("data:") || uri.startsWith("blob:") || uri.startsWith("http")) {
        const resp = await fetch(uri);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none" });
      } else {
        // Relative URL — use Image element to benefit from browser cache
        bitmap = await new Promise<ImageBitmap>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            createImageBitmap(img).then(resolve).catch(reject);
          };
          img.onerror = reject;
          img.src = uri;
        });
      }

      const texture = device.createTexture({
        size: [bitmap.width, bitmap.height],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      queue.copyExternalImageToTexture(
        { source: bitmap, flipY: false },
        { texture },
        [bitmap.width, bitmap.height],
      );
      bitmap.close();

      this.cache.set(uri, texture);
      this.hasNewTextures = true;
    } catch (err) {
      console.warn(`[motion] Failed to load texture "${uri}":`, err);
      this.cache.set(uri, "error");
    }
  }

  /** Release all cached GPU textures. */
  destroy(): void {
    for (const entry of this.cache.values()) {
      if (entry instanceof GPUTexture) entry.destroy();
    }
    this.cache.clear();
  }
}
