/**
 * renderer-webgpu.ts — WebGPU Tier-1 renderer.
 *
 * Implements the `Renderer` interface using WebGPU.  Features:
 *   • Shape pass    — SDF-based rectangle / ellipse / rounded-rect / line
 *   • Image pass    — textured quads with async texture cache
 *   • Text pass     — glyph-atlas-based text rendering
 *   • Blur pass     — separable Gaussian blur (compute shaders)
 *   • Glass pass    — frosted-glass backdrop sampling
 *   • Motion blur   — transform-accumulation (N sub-frames, default 4)
 *   • Color grade   — ACES filmic tone-map + exposure / contrast / saturation
 *
 * All draw passes are chained in the order prescribed by DrawPass in
 * motion-render/src/passes.rs.
 */

import type {
  Renderer,
  RendererOptions,
  RenderNode,
  RenderTransform,
  RenderTree,
  RgbaColor,
} from "./renderer.js";
import {
  buildNodeMap,
  sortNodesByPass,
} from "./renderer.js";
import { GlyphAtlas } from "./gpu/glyph-atlas.js";
import { TextureCache } from "./gpu/texture-cache.js";
import {
  SHAPE_SHADER,
  IMAGE_SHADER,
  TEXT_SHADER,
  GLASS_SHADER,
  BLUR_COMPUTE_SHADER,
  COLOR_GRADE_SHADER,
  ACCUM_SHADER,
  BLIT_SHADER,
} from "./gpu/shaders.js";

// ─── Vertex layout constants ──────────────────────────────────────────────────

/** Shape pass: 18 × f32 = 72 bytes per vertex. */
const SHAPE_VERTEX_SIZE = 72;
/** Image/text/glass pass: 9 × f32 = 36 bytes per vertex. */
const IMAGE_VERTEX_SIZE = 36;
const VERTS_PER_QUAD = 4;
const IDXS_PER_QUAD = 6;
/** Pre-allocated capacity in quads. */
const MAX_QUADS = 32768;

// Pre-build the static index buffer (quad i: 4i+0,4i+1,4i+2, 4i+0,4i+2,4i+3)
function buildIndexData(maxQuads: number): Uint32Array {
  const data = new Uint32Array(maxQuads * IDXS_PER_QUAD);
  for (let i = 0; i < maxQuads; i++) {
    const v = i * VERTS_PER_QUAD;
    const d = i * IDXS_PER_QUAD;
    data[d + 0] = v + 0; data[d + 1] = v + 1; data[d + 2] = v + 2;
    data[d + 3] = v + 0; data[d + 4] = v + 2; data[d + 5] = v + 3;
  }
  return data;
}

// ─── Coordinate helpers ───────────────────────────────────────────────────────

/** Compute the 4 clip-space corner positions for a transformed node quad. */
function quadCorners(
  t: RenderTransform,
  vpW: number,
  vpH: number,
): [[number, number], [number, number], [number, number], [number, number]] {
  const cx  = t.x + t.width  / 2;
  const cy  = t.y + t.height / 2;
  const hw  = (t.width  / 2) * t.scale_x;
  const hh  = (t.height / 2) * t.scale_y;
  const rad = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Local corners: TL, TR, BR, BL
  const local: [number, number][] = [
    [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh],
  ];

  return local.map(([lx, ly]) => {
    const wx = cx + lx * cos - ly * sin;
    const wy = cy + lx * sin + ly * cos;
    return [
      (wx / vpW) * 2.0 - 1.0,   // clip X
      1.0 - (wy / vpH) * 2.0,   // clip Y (Y flipped)
    ];
  }) as [[number, number], [number, number], [number, number], [number, number]];
}

/** Lerp two transforms for motion blur sub-sampling. */
function lerpTransform(a: RenderTransform, b: RenderTransform, t: number): RenderTransform {
  return {
    x:        a.x        + (b.x        - a.x)        * t,
    y:        a.y        + (b.y        - a.y)        * t,
    width:    a.width    + (b.width    - a.width)    * t,
    height:   a.height   + (b.height   - a.height)   * t,
    rotation: a.rotation + (b.rotation - a.rotation) * t,
    scale_x:  a.scale_x  + (b.scale_x  - a.scale_x)  * t,
    scale_y:  a.scale_y  + (b.scale_y  - a.scale_y)  * t,
  };
}

// ─── Premultiplied alpha blend state ─────────────────────────────────────────

const PREMULT_BLEND: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

const ADDITIVE_BLEND: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
};

// ─── WebGpuRenderer ───────────────────────────────────────────────────────────

export class WebGpuRenderer implements Renderer {
  // ── Core GPU objects
  private readonly device: GPUDevice;
  private readonly queue: GPUQueue;
  private readonly context: GPUCanvasContext;
  private readonly swapChainFormat: GPUTextureFormat;

  // ── Pre-allocated geometry buffers
  private readonly shapeVertexBuf: GPUBuffer;  // MAX_QUADS * 4 * 72 bytes
  private readonly imageVertexBuf: GPUBuffer;  // MAX_QUADS * 4 * 36 bytes
  private readonly indexBuf: GPUBuffer;        // MAX_QUADS * 6 * 4 bytes (shared)

  // ── Offscreen render targets (created/destroyed on resize)
  private mainTex!: GPUTexture;       // main render target
  private backdropTex!: GPUTexture;   // copy of main before glass pass
  private blurTempTex!: GPUTexture;   // horizontal blur intermediate
  private blurredTex!: GPUTexture;    // fully blurred backdrop (for glass)
  private subFrameTex!: GPUTexture;   // single sub-frame for motion blur
  private accumTex!: GPUTexture;      // motion blur accumulation

  // ── Samplers
  private readonly linearSampler: GPUSampler;
  private readonly nearestSampler: GPUSampler;

  // ── Render pipelines
  private readonly shapePipeline: GPURenderPipeline;
  private readonly imagePipeline: GPURenderPipeline;
  private readonly textPipeline: GPURenderPipeline;
  private readonly glassPipeline: GPURenderPipeline;
  private readonly colorGradePipeline: GPURenderPipeline;
  private readonly accumPipeline: GPURenderPipeline;
  private readonly blitPipeline: GPURenderPipeline;

  // ── Compute pipelines
  private readonly blurPipeline: GPUComputePipeline;

  // ── Bind group layouts
  private readonly texSampLayout: GPUBindGroupLayout;    // { tex, sampler }
  private readonly glassMaterialLayout: GPUBindGroupLayout;
  private readonly colorGradeLayout: GPUBindGroupLayout;
  private readonly blurLayout: GPUBindGroupLayout;
  private readonly weightLayout: GPUBindGroupLayout;     // { weight uniform }

  // ── Persistent uniform buffers
  private readonly colorGradeUniformBuf: GPUBuffer;
  private readonly weightUniformBuf: GPUBuffer;
  private readonly blurParamsBuf: GPUBuffer;

  // ── Bind groups for persistent data
  private colorGradeBindGroup!: GPUBindGroup;
  private readonly weightBindGroup: GPUBindGroup;

  // ── Helpers
  private readonly glyphAtlas: GlyphAtlas;
  private readonly textureCache: TextureCache;

  // ── Motion blur state
  private readonly motionBlurStrength: number;
  private readonly motionBlurSamples: number;
  private readonly prevTransforms = new Map<string, RenderTransform>();

  // ── Viewport tracking (to detect resize)
  private vpW = 0;
  private vpH = 0;

  // ─────────────────────────────────────────────────────────────────────────────

  private constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    options: Required<RendererOptions>,
  ) {
    this.device  = device;
    this.queue   = device.queue;
    this.context = context;
    this.swapChainFormat = format;
    this.motionBlurStrength = options.motionBlurStrength;
    this.motionBlurSamples  = options.motionBlurSamples;

    // ── Pre-allocate vertex/index buffers
    this.shapeVertexBuf = device.createBuffer({
      label: "motion:shape-verts",
      size:  MAX_QUADS * VERTS_PER_QUAD * SHAPE_VERTEX_SIZE,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.imageVertexBuf = device.createBuffer({
      label: "motion:image-verts",
      size:  MAX_QUADS * VERTS_PER_QUAD * IMAGE_VERTEX_SIZE,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const indexData = buildIndexData(MAX_QUADS);
    this.indexBuf = device.createBuffer({
      label:            "motion:shared-indices",
      size:             indexData.byteLength,
      usage:            GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(this.indexBuf.getMappedRange()).set(indexData);
    this.indexBuf.unmap();

    // ── Samplers
    this.linearSampler  = device.createSampler({ magFilter: "linear",  minFilter: "linear",  mipmapFilter: "linear"  });
    this.nearestSampler = device.createSampler({ magFilter: "nearest", minFilter: "nearest" });

    // ── Bind group layouts
    this.texSampLayout = device.createBindGroupLayout({
      label: "motion:tex-samp",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      ],
    });
    this.glassMaterialLayout = device.createBindGroupLayout({
      label: "motion:glass-mat",
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer:    { type: "uniform" },
      }],
    });
    this.colorGradeLayout = device.createBindGroupLayout({
      label: "motion:color-grade",
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer:    { type: "uniform" },
      }],
    });
    this.blurLayout = device.createBindGroupLayout({
      label: "motion:blur",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba8unorm" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      ],
    });
    this.weightLayout = device.createBindGroupLayout({
      label: "motion:weight",
      entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }],
    });

    // ── Persistent uniform buffers
    this.colorGradeUniformBuf = device.createBuffer({
      label: "motion:color-grade-uniform",
      size:  16,  // 4 × f32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Default: exposure=1, contrast=1, saturation=1, vignette=0
    this.queue.writeBuffer(this.colorGradeUniformBuf, 0, new Float32Array([1, 1, 1, 0]));

    this.weightUniformBuf = device.createBuffer({
      label: "motion:weight-uniform",
      size:  16,  // 4 × f32 (padded)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.weightBindGroup = device.createBindGroup({
      label:  "motion:weight-bg",
      layout: this.weightLayout,
      entries: [{ binding: 0, resource: { buffer: this.weightUniformBuf } }],
    });

    this.blurParamsBuf = device.createBuffer({
      label: "motion:blur-params",
      size:  16,  // 4 × u32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // ── Shader modules
    const shapeMod      = device.createShaderModule({ label: "motion:shape",      code: SHAPE_SHADER });
    const imageMod      = device.createShaderModule({ label: "motion:image",      code: IMAGE_SHADER });
    const textMod       = device.createShaderModule({ label: "motion:text",       code: TEXT_SHADER });
    const glassMod      = device.createShaderModule({ label: "motion:glass",      code: GLASS_SHADER });
    const colorGradeMod = device.createShaderModule({ label: "motion:color-grade",code: COLOR_GRADE_SHADER });
    const accumMod      = device.createShaderModule({ label: "motion:accum",      code: ACCUM_SHADER });
    const blitMod       = device.createShaderModule({ label: "motion:blit",       code: BLIT_SHADER });
    const blurMod       = device.createShaderModule({ label: "motion:blur",       code: BLUR_COMPUTE_SHADER });

    // ── Shape pipeline
    const shapeVBLayout: GPUVertexBufferLayout = {
      arrayStride: SHAPE_VERTEX_SIZE,
      attributes: [
        { shaderLocation: 0, offset:  0, format: "float32x2" }, // clip_pos
        { shaderLocation: 1, offset:  8, format: "float32x2" }, // uv
        { shaderLocation: 2, offset: 16, format: "float32x4" }, // fill
        { shaderLocation: 3, offset: 32, format: "float32x4" }, // stroke
        { shaderLocation: 4, offset: 48, format: "float32"   }, // stroke_w
        { shaderLocation: 5, offset: 52, format: "float32"   }, // corner_r
        { shaderLocation: 6, offset: 56, format: "float32x2" }, // shape_size
        { shaderLocation: 7, offset: 64, format: "float32"   }, // shape_type
        { shaderLocation: 8, offset: 68, format: "float32"   }, // opacity
      ],
    };
    this.shapePipeline = device.createRenderPipeline({
      label:  "motion:shape-pipeline",
      layout: "auto",
      vertex:   { module: shapeMod, entryPoint: "vs_shape", buffers: [shapeVBLayout] },
      fragment: { module: shapeMod, entryPoint: "fs_shape",
                  targets: [{ format: "rgba8unorm", blend: PREMULT_BLEND }] },
      primitive: { topology: "triangle-list" },
    });

    // ── Image pipeline
    const imageVBLayout: GPUVertexBufferLayout = {
      arrayStride: IMAGE_VERTEX_SIZE,
      attributes: [
        { shaderLocation: 0, offset:  0, format: "float32x2" }, // clip_pos
        { shaderLocation: 1, offset:  8, format: "float32x2" }, // uv
        { shaderLocation: 2, offset: 16, format: "float32x4" }, // tint
        { shaderLocation: 3, offset: 32, format: "float32"   }, // opacity
      ],
    };
    const imageLayout = device.createPipelineLayout({
      label:            "motion:image-layout",
      bindGroupLayouts: [this.texSampLayout],
    });
    this.imagePipeline = device.createRenderPipeline({
      label:  "motion:image-pipeline",
      layout: imageLayout,
      vertex:   { module: imageMod, entryPoint: "vs_image", buffers: [imageVBLayout] },
      fragment: { module: imageMod, entryPoint: "fs_image",
                  targets: [{ format: "rgba8unorm", blend: PREMULT_BLEND }] },
      primitive: { topology: "triangle-list" },
    });

    // ── Text pipeline (same vertex layout as image, different shader)
    const textLayout = device.createPipelineLayout({
      label:            "motion:text-layout",
      bindGroupLayouts: [this.texSampLayout],
    });
    this.textPipeline = device.createRenderPipeline({
      label:  "motion:text-pipeline",
      layout: textLayout,
      vertex:   { module: textMod, entryPoint: "vs_text", buffers: [imageVBLayout] },
      fragment: { module: textMod, entryPoint: "fs_text",
                  targets: [{ format: "rgba8unorm", blend: PREMULT_BLEND }] },
      primitive: { topology: "triangle-list" },
    });

    // ── Glass pipeline
    const glassLayout = device.createPipelineLayout({
      label:            "motion:glass-layout",
      bindGroupLayouts: [this.texSampLayout, this.glassMaterialLayout],
    });
    this.glassPipeline = device.createRenderPipeline({
      label:  "motion:glass-pipeline",
      layout: glassLayout,
      vertex:   { module: glassMod, entryPoint: "vs_glass", buffers: [imageVBLayout] },
      fragment: { module: glassMod, entryPoint: "fs_glass",
                  targets: [{ format: "rgba8unorm", blend: PREMULT_BLEND }] },
      primitive: { topology: "triangle-list" },
    });

    // ── Color grade pipeline (fullscreen triangle — no vertex buffer)
    const colorGradeLayout = device.createPipelineLayout({
      label:            "motion:color-grade-layout",
      bindGroupLayouts: [this.texSampLayout, this.colorGradeLayout],
    });
    this.colorGradePipeline = device.createRenderPipeline({
      label:  "motion:color-grade-pipeline",
      layout: colorGradeLayout,
      vertex:   { module: colorGradeMod, entryPoint: "vs_fullscreen" },
      fragment: { module: colorGradeMod, entryPoint: "fs_color_grade",
                  targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });

    // ── Accumulation pipeline (additive blend — for motion blur)
    const accumLayout = device.createPipelineLayout({
      label:            "motion:accum-layout",
      bindGroupLayouts: [this.texSampLayout, this.weightLayout],
    });
    this.accumPipeline = device.createRenderPipeline({
      label:  "motion:accum-pipeline",
      layout: accumLayout,
      vertex:   { module: accumMod, entryPoint: "vs_fullscreen" },
      fragment: { module: accumMod, entryPoint: "fs_accum",
                  targets: [{ format: "rgba16float", blend: ADDITIVE_BLEND }] },
      primitive: { topology: "triangle-list" },
    });

    // ── Blit pipeline
    const blitLayout = device.createPipelineLayout({
      label:            "motion:blit-layout",
      bindGroupLayouts: [this.texSampLayout],
    });
    this.blitPipeline = device.createRenderPipeline({
      label:  "motion:blit-pipeline",
      layout: blitLayout,
      vertex:   { module: blitMod, entryPoint: "vs_fullscreen" },
      fragment: { module: blitMod, entryPoint: "fs_blit",
                  targets: [{ format: "rgba8unorm", blend: PREMULT_BLEND }] },
      primitive: { topology: "triangle-list" },
    });

    // ── Blur compute pipeline
    const blurPipelineLayout = device.createPipelineLayout({
      label:            "motion:blur-compute-layout",
      bindGroupLayouts: [this.blurLayout],
    });
    this.blurPipeline = device.createComputePipeline({
      label:   "motion:blur-compute-pipeline",
      layout:  blurPipelineLayout,
      compute: { module: blurMod, entryPoint: "cs_blur" },
    });

    // ── Helpers
    this.glyphAtlas   = new GlyphAtlas();
    this.textureCache = new TextureCache();
  }

  // ── Static factory ──────────────────────────────────────────────────────────

  static async create(
    canvas: HTMLCanvasElement,
    options?: RendererOptions,
  ): Promise<WebGpuRenderer> {
    if (!navigator.gpu) throw new Error("WebGPU not supported");

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No WebGPU adapter found");

    const device = await adapter.requestDevice({
      requiredFeatures: ["float32-filterable"],
    }).catch(() => adapter.requestDevice()); // retry without optional features

    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("Failed to get WebGPU canvas context");

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "premultiplied" });

    const opts: Required<RendererOptions> = {
      motionBlurStrength: Math.max(0, Math.min(1, options?.motionBlurStrength ?? 0)),
      motionBlurSamples:  Math.max(1, Math.min(8, options?.motionBlurSamples ?? 4)),
    };

    const renderer = new WebGpuRenderer(device, context, format, opts);

    // Register device-loss handler for graceful recovery
    void device.lost.then((info) => {
      console.warn("[motion] WebGPU device lost:", info.message);
    });

    return renderer;
  }

  // ── Public interface ────────────────────────────────────────────────────────

  resize(cssWidth: number, cssHeight: number, dpr = window.devicePixelRatio ?? 1): void {
    const pw = Math.max(1, Math.round(cssWidth  * dpr));
    const ph = Math.max(1, Math.round(cssHeight * dpr));
    if (pw === this.vpW && ph === this.vpH) return;

    this.vpW = pw;
    this.vpH = ph;

    // Destroy old offscreen textures
    this.mainTex?.destroy();
    this.backdropTex?.destroy();
    this.blurTempTex?.destroy();
    this.blurredTex?.destroy();
    this.subFrameTex?.destroy();
    this.accumTex?.destroy();

    const mainUsage =
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING   |
      GPUTextureUsage.COPY_SRC          |
      GPUTextureUsage.COPY_DST;

    const blurUsage =
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING   |
      GPUTextureUsage.STORAGE_BINDING   |
      GPUTextureUsage.COPY_DST;

    this.mainTex = this.device.createTexture({
      label: "motion:main",     size: [pw, ph], format: "rgba8unorm", usage: mainUsage,
    });
    this.backdropTex = this.device.createTexture({
      label: "motion:backdrop", size: [pw, ph], format: "rgba8unorm", usage: mainUsage,
    });
    this.blurTempTex = this.device.createTexture({
      label: "motion:blur-temp",size: [pw, ph], format: "rgba8unorm", usage: blurUsage,
    });
    this.blurredTex = this.device.createTexture({
      label: "motion:blurred",  size: [pw, ph], format: "rgba8unorm", usage: blurUsage,
    });
    this.subFrameTex = this.device.createTexture({
      label: "motion:sub-frame",size: [pw, ph], format: "rgba8unorm", usage: mainUsage,
    });
    this.accumTex = this.device.createTexture({
      label: "motion:accum",    size: [pw, ph], format: "rgba16float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    // Rebuild the color-grade bind group whenever the main texture changes
    this.rebuildColorGradeBindGroup();
  }

  draw(tree: RenderTree): void {
    // Resize render targets if viewport changed
    if (tree.viewport_width > 0 && tree.viewport_height > 0) {
      this.resize(tree.viewport_width, tree.viewport_height, tree.device_pixel_ratio);
    }
    if (this.vpW === 0 || this.vpH === 0) return;

    // Sync glyph atlas to GPU once per frame
    this.glyphAtlas.syncTexture(this.device, this.queue);

    const nodeMap = buildNodeMap(tree.nodes);
    const visibleNodes = tree.nodes.filter((n) => n.visible && n.opacity > 0);

    const useMotionBlur =
      this.motionBlurStrength > 0 &&
      this.motionBlurSamples  > 1 &&
      this.prevTransforms.size > 0;

    if (useMotionBlur) {
      this.drawWithMotionBlur(tree, nodeMap, visibleNodes);
    } else {
      this.drawScene(tree, nodeMap, visibleNodes, this.mainTex, /* clearColor */ true);
      this.runColorGradePass();
    }

    // Store current transforms for next frame's motion blur
    for (const node of tree.nodes) {
      this.prevTransforms.set(node.id, node.transform);
    }
  }

  destroy(): void {
    this.shapeVertexBuf.destroy();
    this.imageVertexBuf.destroy();
    this.indexBuf.destroy();
    this.colorGradeUniformBuf.destroy();
    this.weightUniformBuf.destroy();
    this.blurParamsBuf.destroy();
    this.mainTex?.destroy();
    this.backdropTex?.destroy();
    this.blurTempTex?.destroy();
    this.blurredTex?.destroy();
    this.subFrameTex?.destroy();
    this.accumTex?.destroy();
    this.glyphAtlas.destroy();
    this.textureCache.destroy();
    this.device.destroy();
  }

  // ── Motion blur ─────────────────────────────────────────────────────────────

  private drawWithMotionBlur(
    tree: RenderTree,
    nodeMap: Map<string, RenderNode>,
    visibleNodes: RenderNode[],
  ): void {
    const N       = this.motionBlurSamples;
    const weight  = 1.0 / N;

    // Update weight uniform
    this.queue.writeBuffer(
      this.weightUniformBuf, 0,
      new Float32Array([weight, 0, 0, 0]),
    );

    // Clear accumulation texture
    const clearEncoder = this.device.createCommandEncoder({ label: "motion:mb-clear" });
    const clearPass = clearEncoder.beginRenderPass({
      colorAttachments: [{
        view:       this.accumTex.createView(),
        loadOp:     "clear",
        storeOp:    "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    clearPass.end();
    this.queue.submit([clearEncoder.finish()]);

    for (let i = 0; i < N; i++) {
      const t = N > 1 ? i / (N - 1) : 0;

      // Build a modified render tree with lerped transforms
      const subTree = this.lerpTreeTransforms(tree, t);
      const subNodeMap  = buildNodeMap(subTree.nodes);
      const subVisible  = subTree.nodes.filter((n) => n.visible && n.opacity > 0);

      // Render sub-frame to subFrameTex
      this.drawScene(subTree, subNodeMap, subVisible, this.subFrameTex, true);

      // Accumulate into accumTex with additive blend
      this.runAccumPass();
    }

    // Final: blit accumTex (resolved average) to mainTex, then color grade to swap chain
    this.runBlitPass(this.accumTex, this.mainTex.createView());
    this.runColorGradePass();
  }

  private lerpTreeTransforms(tree: RenderTree, t: number): RenderTree {
    const nodes = tree.nodes.map((node) => {
      const prev = this.prevTransforms.get(node.id);
      if (!prev) return node;
      // Scale motion blur contribution by per-node strength (always multiply so
      // that a strength of 0 means no interpolation, i.e. lerpT = 0).
      const strength = node.motion_blur_strength * this.motionBlurStrength;
      const lerpT    = t * strength;
      return { ...node, transform: lerpTransform(prev, node.transform, lerpT) };
    });
    return { ...tree, nodes };
  }

  // ── Scene rendering ─────────────────────────────────────────────────────────

  private drawScene(
    tree: RenderTree,
    nodeMap: Map<string, RenderNode>,
    visibleNodes: RenderNode[],
    target: GPUTexture,
    clear: boolean,
  ): void {
    const sorted = sortNodesByPass(visibleNodes);
    const vpW = this.vpW;
    const vpH = this.vpH;

    // Separate nodes by pass
    const shapeNodes: RenderNode[] = [];
    const imageNodes: RenderNode[] = [];
    const textNodes:  RenderNode[] = [];
    const glassNodes: RenderNode[] = [];
    const blurNodes:  RenderNode[] = [];

    for (const n of sorted) {
      switch (n.draw_pass) {
        case "shape":       shapeNodes.push(n); break;
        case "image_video": imageNodes.push(n); break;
        case "text":        textNodes.push(n);  break;
        case "blur":        blurNodes.push(n);  break;
        case "glass":       glassNodes.push(n); break;
        // shadow, mask, particles, composite, color_grade handled in dedicated passes
        default: break;
      }
    }

    const encoder = this.device.createCommandEncoder({ label: "motion:scene" });

    // ── Main render pass (shape + image + text)
    {
      const passDesc: GPURenderPassDescriptor = {
        colorAttachments: [{
          view:       target.createView(),
          loadOp:     clear ? "clear" : "load",
          storeOp:    "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      };
      const pass = encoder.beginRenderPass(passDesc);
      pass.setIndexBuffer(this.indexBuf, "uint32");

      // Shape pass
      if (shapeNodes.length > 0) {
        const shapeData = this.buildShapeGeometry(shapeNodes, vpW, vpH);
        if (shapeData.quadCount > 0) {
          this.queue.writeBuffer(this.shapeVertexBuf, 0, shapeData.verts.buffer as ArrayBuffer, shapeData.verts.byteOffset, shapeData.verts.byteLength);
          pass.setPipeline(this.shapePipeline);
          pass.setVertexBuffer(0, this.shapeVertexBuf);
          pass.drawIndexed(shapeData.quadCount * IDXS_PER_QUAD);
        }
      }

      // Image/video pass
      if (imageNodes.length > 0) {
        pass.setPipeline(this.imagePipeline);
        for (const node of imageNodes) {
          this.drawImageNode(pass, node, vpW, vpH);
        }
      }

      // Text pass
      if (textNodes.length > 0) {
        const textData = this.buildTextGeometry(textNodes, vpW, vpH);
        if (textData.quadCount > 0) {
          const atlasTex = this.glyphAtlas.syncTexture(this.device, this.queue);
          const atlasView = atlasTex.createView();
          const atlasBG = this.device.createBindGroup({
            layout: this.texSampLayout,
            entries: [
              { binding: 0, resource: atlasView },
              { binding: 1, resource: this.linearSampler },
            ],
          });
          this.queue.writeBuffer(this.imageVertexBuf, 0, textData.verts.buffer as ArrayBuffer, textData.verts.byteOffset, textData.verts.byteLength);
          pass.setPipeline(this.textPipeline);
          pass.setVertexBuffer(0, this.imageVertexBuf);
          pass.setBindGroup(0, atlasBG);
          pass.drawIndexed(textData.quadCount * IDXS_PER_QUAD);
        }
      }

      // Blur nodes: render with approximate CSS-style blur.
      // Full compute-based Gaussian blur is applied to the backdrop before the
      // glass pass; per-node blur uses a simple overlay for the MVP.
      if (blurNodes.length > 0) {
        // Treat blur nodes the same as shape nodes but with reduced opacity
        const blurShapeData = this.buildShapeGeometry(blurNodes, vpW, vpH);
        if (blurShapeData.quadCount > 0) {
          this.queue.writeBuffer(this.shapeVertexBuf, 0, blurShapeData.verts.buffer as ArrayBuffer, blurShapeData.verts.byteOffset, blurShapeData.verts.byteLength);
          pass.setPipeline(this.shapePipeline);
          pass.setVertexBuffer(0, this.shapeVertexBuf);
          pass.drawIndexed(blurShapeData.quadCount * IDXS_PER_QUAD);
        }
      }

      pass.end();
    }

    // ── If there are glass nodes, blur the backdrop and draw glass on top
    if (glassNodes.length > 0) {
      // 1. Copy main render to backdropTex
      encoder.copyTextureToTexture(
        { texture: target },
        { texture: this.backdropTex },
        [vpW, vpH],
      );

      // 2. Gaussian blur backdrop (horizontal then vertical)
      // Determine blur radius from first glass node's blur_radius (or default 16px)
      const blurRadius = Math.max(
        ...glassNodes.map((n) => {
          const mat = n.material;
          return mat?.type === "glass" ? mat.blur_radius : 16;
        }),
        8,
      );
      this.runGaussianBlur(encoder, this.backdropTex, this.blurTempTex, this.blurredTex, blurRadius);

      // 3. Draw glass nodes sampling the blurred backdrop
      const glassPass = encoder.beginRenderPass({
        colorAttachments: [{
          view:    target.createView(),
          loadOp:  "load",
          storeOp: "store",
        }],
      });
      glassPass.setIndexBuffer(this.indexBuf, "uint32");
      glassPass.setPipeline(this.glassPipeline);

      const backdropBG = this.device.createBindGroup({
        layout: this.texSampLayout,
        entries: [
          { binding: 0, resource: this.blurredTex.createView() },
          { binding: 1, resource: this.linearSampler },
        ],
      });
      glassPass.setBindGroup(0, backdropBG);

      for (const node of glassNodes) {
        this.drawGlassNode(glassPass, node, vpW, vpH);
      }

      glassPass.end();
    }

    this.queue.submit([encoder.finish()]);
  }

  // ── Color grade final pass ──────────────────────────────────────────────────

  private rebuildColorGradeBindGroup(): void {
    this.colorGradeBindGroup = this.device.createBindGroup({
      label:  "motion:color-grade-bg",
      layout: this.texSampLayout,
      entries: [
        { binding: 0, resource: this.mainTex.createView() },
        { binding: 1, resource: this.linearSampler },
      ],
    });
  }

  private runColorGradePass(): void {
    const swapView = this.context.getCurrentTexture().createView();
    const gradeParamsBG = this.device.createBindGroup({
      layout: this.colorGradeLayout,
      entries: [{ binding: 0, resource: { buffer: this.colorGradeUniformBuf } }],
    });

    const encoder = this.device.createCommandEncoder({ label: "motion:color-grade" });
    const pass    = encoder.beginRenderPass({
      colorAttachments: [{
        view:    swapView,
        loadOp:  "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });
    pass.setPipeline(this.colorGradePipeline);
    pass.setBindGroup(0, this.colorGradeBindGroup);
    pass.setBindGroup(1, gradeParamsBG);
    pass.draw(3);
    pass.end();
    this.queue.submit([encoder.finish()]);
  }

  // ── Gaussian blur (compute) ─────────────────────────────────────────────────

  private runGaussianBlur(
    encoder: GPUCommandEncoder,
    input: GPUTexture,
    temp: GPUTexture,
    output: GPUTexture,
    radius: number,
  ): void {
    const r    = Math.max(1, Math.min(32, Math.round(radius)));
    const w    = this.vpW;
    const h    = this.vpH;
    const wgX  = Math.ceil(w / 8);
    const wgY  = Math.ceil(h / 8);

    // Horizontal pass: input → temp
    this.queue.writeBuffer(this.blurParamsBuf, 0, new Uint32Array([r, 1, w, h]));
    const hBG = this.device.createBindGroup({
      layout: this.blurLayout,
      entries: [
        { binding: 0, resource: input.createView() },
        { binding: 1, resource: temp.createView()  },
        { binding: 2, resource: { buffer: this.blurParamsBuf } },
      ],
    });
    const hPass = encoder.beginComputePass({ label: "motion:blur-h" });
    hPass.setPipeline(this.blurPipeline);
    hPass.setBindGroup(0, hBG);
    hPass.dispatchWorkgroups(wgX, wgY);
    hPass.end();

    // Vertical pass: temp → output
    this.queue.writeBuffer(this.blurParamsBuf, 0, new Uint32Array([r, 0, w, h]));
    const vBG = this.device.createBindGroup({
      layout: this.blurLayout,
      entries: [
        { binding: 0, resource: temp.createView()   },
        { binding: 1, resource: output.createView() },
        { binding: 2, resource: { buffer: this.blurParamsBuf } },
      ],
    });
    const vPass = encoder.beginComputePass({ label: "motion:blur-v" });
    vPass.setPipeline(this.blurPipeline);
    vPass.setBindGroup(0, vBG);
    vPass.dispatchWorkgroups(wgX, wgY);
    vPass.end();
  }

  // ── Accumulation pass (motion blur) ────────────────────────────────────────

  private runAccumPass(): void {
    const srcBG = this.device.createBindGroup({
      layout: this.texSampLayout,
      entries: [
        { binding: 0, resource: this.subFrameTex.createView() },
        { binding: 1, resource: this.linearSampler },
      ],
    });
    const encoder = this.device.createCommandEncoder({ label: "motion:accum" });
    const pass    = encoder.beginRenderPass({
      colorAttachments: [{
        view:    this.accumTex.createView(),
        loadOp:  "load",
        storeOp: "store",
      }],
    });
    pass.setPipeline(this.accumPipeline);
    pass.setBindGroup(0, srcBG);
    pass.setBindGroup(1, this.weightBindGroup);
    pass.draw(3);
    pass.end();
    this.queue.submit([encoder.finish()]);
  }

  // ── Blit pass ───────────────────────────────────────────────────────────────

  private runBlitPass(src: GPUTexture, dstView: GPUTextureView): void {
    const srcBG = this.device.createBindGroup({
      layout: this.texSampLayout,
      entries: [
        { binding: 0, resource: src.createView() },
        { binding: 1, resource: this.linearSampler },
      ],
    });
    const encoder = this.device.createCommandEncoder({ label: "motion:blit" });
    const pass    = encoder.beginRenderPass({
      colorAttachments: [{
        view:    dstView,
        loadOp:  "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    pass.setPipeline(this.blitPipeline);
    pass.setBindGroup(0, srcBG);
    pass.draw(3);
    pass.end();
    this.queue.submit([encoder.finish()]);
  }

  // ── Geometry builders ────────────────────────────────────────────────────────

  /** Build interleaved shape vertex data for a list of shape/frame/group nodes. */
  private buildShapeGeometry(
    nodes: RenderNode[],
    vpW: number,
    vpH: number,
  ): { verts: Float32Array; quadCount: number } {
    const floatsPerVertex = SHAPE_VERTEX_SIZE / 4;
    const floatsPerQuad   = floatsPerVertex * VERTS_PER_QUAD;
    const buf = new Float32Array(nodes.length * floatsPerQuad);
    let quadCount = 0;

    for (const node of nodes) {
      const t   = node.transform;
      const mat = node.material;
      const c   = node.content;

      // Determine fill and stroke colours from content or material
      let fill:   RgbaColor = { r: 0, g: 0, b: 0, a: 0 };
      let stroke: RgbaColor = { r: 0, g: 0, b: 0, a: 0 };
      let strokeW    = 0;
      let cornerR    = 0;
      let shapeType  = 0; // 0 = rect

      if (c.type === "shape") {
        fill       = c.fill   ?? fill;
        stroke     = c.stroke ?? stroke;
        strokeW    = c.stroke_width;
        if (c.kind.type === "ellipse")          shapeType = 1;
        if (c.kind.type === "rounded_rectangle") {
          shapeType = 2;
          cornerR   = c.kind.corner_radius;
        }
        if (c.kind.type === "line")             shapeType = 3;
      } else if (mat) {
        // Frame/Group with material
        fill = this.materialToFill(mat) ?? fill;
        if (mat.type === "matte_card") cornerR = mat.corner_radius;
      } else {
        continue; // Frame/Group with no material: no geometry
      }

      // Apply material override for solid/gradient fills
      if (mat && c.type !== "shape") {
        fill = this.materialToFill(mat) ?? fill;
      } else if (mat && c.type === "shape" && !c.fill) {
        fill = this.materialToFill(mat) ?? fill;
      }

      const corners = quadCorners(t, vpW, vpH);
      const uvs: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
      const shapeW = t.width  * t.scale_x;
      const shapeH = t.height * t.scale_y;

      for (let vi = 0; vi < 4; vi++) {
        const off = (quadCount * VERTS_PER_QUAD + vi) * floatsPerVertex;
        const [cx, cy] = corners[vi]!;
        const [ux, uy] = uvs[vi]!;
        buf[off +  0] = cx;
        buf[off +  1] = cy;
        buf[off +  2] = ux;
        buf[off +  3] = uy;
        buf[off +  4] = fill.r;
        buf[off +  5] = fill.g;
        buf[off +  6] = fill.b;
        buf[off +  7] = fill.a;
        buf[off +  8] = stroke.r;
        buf[off +  9] = stroke.g;
        buf[off + 10] = stroke.b;
        buf[off + 11] = stroke.a;
        buf[off + 12] = strokeW;
        buf[off + 13] = cornerR;
        buf[off + 14] = shapeW;
        buf[off + 15] = shapeH;
        buf[off + 16] = shapeType;
        buf[off + 17] = node.opacity;
      }
      quadCount++;
    }

    return { verts: buf.subarray(0, quadCount * floatsPerQuad), quadCount };
  }

  /** Build glyph quads for a list of text nodes. */
  private buildTextGeometry(
    nodes: RenderNode[],
    vpW: number,
    vpH: number,
  ): { verts: Float32Array; quadCount: number } {
    const floatsPerVertex = IMAGE_VERTEX_SIZE / 4;
    const maxGlyphs = nodes.reduce((sum, n) =>
      sum + (n.content.type === "text" ? n.content.content.length : 0), 0);
    const buf = new Float32Array(maxGlyphs * VERTS_PER_QUAD * floatsPerVertex);
    let quadCount = 0;

    for (const node of nodes) {
      if (node.content.type !== "text") continue;
      const { content, color, font_family, font_size, line_height } = node.content;
      const t    = node.transform;
      const lineH = font_size * line_height;
      let penX    = t.x;
      let penY    = t.y;

      for (const char of content) {
        if (char === "\n") {
          penX = t.x;
          penY += lineH;
          continue;
        }
        if (char === " ") {
          const sp = this.glyphAtlas.getGlyph(" ", font_family, font_size);
          if (sp) penX += sp.advance;
          continue;
        }

        const glyph = this.glyphAtlas.getGlyph(char, font_family, font_size);
        if (!glyph) continue;

        // Word-wrap
        if (penX + glyph.w > t.x + t.width && penX > t.x) {
          penX  = t.x;
          penY += lineH;
        }
        if (penY + glyph.h > t.y + t.height) break;

        const gx = penX;
        const gy = penY + font_size - glyph.bearingY;

        // 4 corners of the glyph quad in screen space
        const screenCorners: [number, number][] = [
          [gx,           gy          ],
          [gx + glyph.w, gy          ],
          [gx + glyph.w, gy + glyph.h],
          [gx,           gy + glyph.h],
        ];
        const uvs: [number, number][] = [
          [glyph.u0, glyph.v0],
          [glyph.u1, glyph.v0],
          [glyph.u1, glyph.v1],
          [glyph.u0, glyph.v1],
        ];

        for (let vi = 0; vi < 4; vi++) {
          const [sx, sy] = screenCorners[vi]!;
          const [u,  v ] = uvs[vi]!;
          const off = (quadCount * VERTS_PER_QUAD + vi) * floatsPerVertex;
          buf[off + 0] = (sx / vpW) * 2.0 - 1.0;
          buf[off + 1] = 1.0 - (sy / vpH) * 2.0;
          buf[off + 2] = u;
          buf[off + 3] = v;
          buf[off + 4] = color.r;
          buf[off + 5] = color.g;
          buf[off + 6] = color.b;
          buf[off + 7] = color.a;
          buf[off + 8] = node.opacity;
        }

        penX += glyph.advance;
        quadCount++;
      }
    }

    return { verts: buf.subarray(0, quadCount * VERTS_PER_QUAD * floatsPerVertex), quadCount };
  }

  // ── Per-node draw helpers ────────────────────────────────────────────────────

  private drawImageNode(
    pass: GPURenderPassEncoder,
    node: RenderNode,
    vpW: number,
    vpH: number,
  ): void {
    if (node.content.type !== "image" && node.content.type !== "video") return;

    const uri = node.content.uri;
    const tex  = this.textureCache.get(uri, this.device, this.queue);
    if (!tex) return; // still loading; skip this frame

    const corners = quadCorners(node.transform, vpW, vpH);
    const uvs: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const verts = new Float32Array(VERTS_PER_QUAD * (IMAGE_VERTEX_SIZE / 4));
    for (let vi = 0; vi < 4; vi++) {
      const off      = vi * (IMAGE_VERTEX_SIZE / 4);
      const [cx, cy] = corners[vi]!;
      const [u,   v] = uvs[vi]!;
      verts[off + 0] = cx;
      verts[off + 1] = cy;
      verts[off + 2] = u;
      verts[off + 3] = v;
      verts[off + 4] = 1; // tint r
      verts[off + 5] = 1; // tint g
      verts[off + 6] = 1; // tint b
      verts[off + 7] = 1; // tint a
      verts[off + 8] = node.opacity;
    }
    this.queue.writeBuffer(this.imageVertexBuf, 0, verts);

    const bg = this.device.createBindGroup({
      layout: this.texSampLayout,
      entries: [
        { binding: 0, resource: tex.createView() },
        { binding: 1, resource: this.linearSampler },
      ],
    });
    pass.setVertexBuffer(0, this.imageVertexBuf);
    pass.setBindGroup(0, bg);
    pass.setIndexBuffer(this.indexBuf, "uint32");
    pass.drawIndexed(IDXS_PER_QUAD);
  }

  private drawGlassNode(
    pass: GPURenderPassEncoder,
    node: RenderNode,
    vpW: number,
    vpH: number,
  ): void {
    const mat = node.material;
    if (!mat || mat.type !== "glass") return;

    const corners = quadCorners(node.transform, vpW, vpH);
    const uvs: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const verts = new Float32Array(VERTS_PER_QUAD * (IMAGE_VERTEX_SIZE / 4));
    for (let vi = 0; vi < 4; vi++) {
      const off      = vi * (IMAGE_VERTEX_SIZE / 4);
      const [cx, cy] = corners[vi]!;
      const [u,   v] = uvs[vi]!;
      verts[off + 0] = cx;
      verts[off + 1] = cy;
      verts[off + 2] = u;
      verts[off + 3] = v;
      verts[off + 4] = 0; // unused tint
      verts[off + 5] = 0;
      verts[off + 6] = 0;
      verts[off + 7] = 0;
      verts[off + 8] = node.opacity;
    }
    this.queue.writeBuffer(this.imageVertexBuf, 0, verts);

    // Glass material uniform: tint(vec4), opacity(f32), saturation(f32), noise_strength(f32), edge_hi_alpha(f32)
    const glassBuf = this.device.createBuffer({
      size:  32, // 8 × f32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.queue.writeBuffer(glassBuf, 0, new Float32Array([
      mat.tint.r, mat.tint.g, mat.tint.b, mat.tint.a,
      mat.opacity,
      mat.saturation,
      mat.noise_strength,
      0.08, // edge highlight alpha
    ]));
    const glassBG = this.device.createBindGroup({
      layout: this.glassMaterialLayout,
      entries: [{ binding: 0, resource: { buffer: glassBuf } }],
    });
    pass.setBindGroup(1, glassBG);
    pass.setVertexBuffer(0, this.imageVertexBuf);
    pass.setIndexBuffer(this.indexBuf, "uint32");
    pass.drawIndexed(IDXS_PER_QUAD);
    // Destroy the per-frame uniform buffer after submission would be ideal,
    // but we can't do that here; the device queue will hold a ref until done.
    // For correctness, we rely on GC or future buffer pooling.
  }

  // ── Material helper ──────────────────────────────────────────────────────────

  private materialToFill(mat: import("./renderer.js").ResolvedMaterial): RgbaColor | null {
    switch (mat.type) {
      case "solid":      return mat.color;
      case "glass":      return { ...mat.tint, a: mat.opacity };
      case "matte_card": return mat.background;
      case "glow":       return { ...mat.color, a: mat.intensity };
      case "gradient":   return mat.stops[0]?.color ?? null;
      default:           return null;
    }
  }
}
