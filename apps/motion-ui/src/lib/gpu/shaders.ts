/**
 * gpu/shaders.ts — WGSL shader source strings for all GPU render passes.
 *
 * Each exported constant is a self-contained WGSL module string that can be
 * passed to `device.createShaderModule({ code: ... })`.
 */

// ─── Shape pass (SDF-based geometry) ─────────────────────────────────────────

/**
 * Shape pass shaders.
 *
 * Vertex layout (72 bytes / vertex):
 *   offset  0: clip_pos    vec2f  — clip-space XY, precomputed on CPU
 *   offset  8: uv          vec2f  — [0,1]×[0,1] local UVs for SDF
 *   offset 16: fill        vec4f  — RGBA fill colour
 *   offset 32: stroke      vec4f  — RGBA stroke colour
 *   offset 48: stroke_w    f32    — stroke width in CSS pixels
 *   offset 52: corner_r    f32    — corner radius in CSS pixels
 *   offset 56: shape_size  vec2f  — pixel width/height (post-scale)
 *   offset 64: shape_type  f32    — 0=rect, 1=ellipse, 2=rounded_rect, 3=line
 *   offset 68: opacity     f32
 */
export const SHAPE_SHADER = /* wgsl */ `
struct VertIn {
  @location(0) clip_pos   : vec2<f32>,
  @location(1) uv         : vec2<f32>,
  @location(2) fill       : vec4<f32>,
  @location(3) stroke     : vec4<f32>,
  @location(4) stroke_w   : f32,
  @location(5) corner_r   : f32,
  @location(6) shape_size : vec2<f32>,
  @location(7) shape_type : f32,
  @location(8) opacity    : f32,
}

struct VertOut {
  @builtin(position) pos  : vec4<f32>,
  @location(0) uv         : vec2<f32>,
  @location(1) fill       : vec4<f32>,
  @location(2) stroke     : vec4<f32>,
  @location(3) stroke_w   : f32,
  @location(4) corner_r   : f32,
  @location(5) shape_size : vec2<f32>,
  @location(6) shape_type : f32,
  @location(7) opacity    : f32,
}

@vertex
fn vs_shape(in: VertIn) -> VertOut {
  var out: VertOut;
  out.pos        = vec4<f32>(in.clip_pos, 0.0, 1.0);
  out.uv         = in.uv;
  out.fill       = in.fill;
  out.stroke     = in.stroke;
  out.stroke_w   = in.stroke_w;
  out.corner_r   = in.corner_r;
  out.shape_size = in.shape_size;
  out.shape_type = in.shape_type;
  out.opacity    = in.opacity;
  return out;
}

// ─── SDF primitives ──────────────────────────────────────────────────────────

fn sdf_rect(p: vec2<f32>, size: vec2<f32>) -> f32 {
  let d = abs(p) - size * 0.5;
  return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
}

fn sdf_rounded_rect(p: vec2<f32>, size: vec2<f32>, r: f32) -> f32 {
  let d = abs(p) - size * 0.5 + vec2<f32>(r);
  return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0) - r;
}

fn sdf_ellipse(p: vec2<f32>, size: vec2<f32>) -> f32 {
  // Approximate: scale into unit circle then compute SDF in pixel space
  let r = size * 0.5;
  let q = p / r;
  return (length(q) - 1.0) * min(r.x, r.y);
}

fn sdf_line(p: vec2<f32>, size: vec2<f32>) -> f32 {
  let hw = size.x * 0.5;
  let cx = clamp(p.x, -hw, hw);
  return length(p - vec2<f32>(cx, 0.0));
}

@fragment
fn fs_shape(in: VertOut) -> @location(0) vec4<f32> {
  // p = pixel coordinates relative to shape centre
  let p = (in.uv - vec2<f32>(0.5)) * in.shape_size;
  let t = i32(in.shape_type);

  var dist: f32;
  switch t {
    case 1: { dist = sdf_ellipse(p, in.shape_size); }
    case 2: { dist = sdf_rounded_rect(p, in.shape_size, in.corner_r); }
    case 3: { dist = sdf_line(p, in.shape_size) - 0.5; }
    default: { dist = sdf_rect(p, in.shape_size); }
  }

  // Anti-aliased interior alpha
  let fill_a = smoothstep(1.0, -1.0, dist) * in.fill.a;
  var color = vec4<f32>(in.fill.rgb, fill_a);

  // Anti-aliased stroke
  if in.stroke_w > 0.0 {
    let sd = abs(dist) - in.stroke_w * 0.5;
    let stroke_a = smoothstep(1.0, -1.0, sd) * in.stroke.a;
    // Blend stroke over fill using "over" compositing
    let sa = stroke_a * (1.0 - color.a) + stroke_a * color.a;
    color = vec4<f32>(mix(color.rgb, in.stroke.rgb, stroke_a / max(sa, 0.0001)), sa);
  }

  color.a *= in.opacity;
  // Premultiply for correct alpha blending on the render target
  return vec4<f32>(color.rgb * color.a, color.a);
}
`;

// ─── Image / video pass ───────────────────────────────────────────────────────

/**
 * Textured-quad shaders for images and videos.
 *
 * Vertex layout (36 bytes / vertex):
 *   offset  0: clip_pos  vec2f
 *   offset  8: uv        vec2f
 *   offset 16: tint      vec4f  — (1,1,1,1) for plain image
 *   offset 32: opacity   f32
 */
export const IMAGE_SHADER = /* wgsl */ `
@group(0) @binding(0) var tex  : texture_2d<f32>;
@group(0) @binding(1) var samp : sampler;

struct VertIn {
  @location(0) clip_pos : vec2<f32>,
  @location(1) uv       : vec2<f32>,
  @location(2) tint     : vec4<f32>,
  @location(3) opacity  : f32,
}
struct VertOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv        : vec2<f32>,
  @location(1) tint      : vec4<f32>,
  @location(2) opacity   : f32,
}

@vertex
fn vs_image(in: VertIn) -> VertOut {
  var out: VertOut;
  out.pos     = vec4<f32>(in.clip_pos, 0.0, 1.0);
  out.uv      = in.uv;
  out.tint    = in.tint;
  out.opacity = in.opacity;
  return out;
}

@fragment
fn fs_image(in: VertOut) -> @location(0) vec4<f32> {
  var c = textureSample(tex, samp, in.uv);
  c    = vec4<f32>(c.rgb * in.tint.rgb, c.a * in.tint.a * in.opacity);
  return vec4<f32>(c.rgb * c.a, c.a); // premultiply
}
`;

// ─── Text pass (glyph atlas) ──────────────────────────────────────────────────

/**
 * Glyph-atlas text shaders.
 *
 * Vertex layout: same 36-byte layout as IMAGE_SHADER.
 *   tint = the text colour  (atlas alpha used as mask)
 *
 * The glyph atlas is rasterised in white on a transparent background so
 * the atlas's alpha channel acts as a coverage mask.
 */
export const TEXT_SHADER = /* wgsl */ `
@group(0) @binding(0) var atlas : texture_2d<f32>;
@group(0) @binding(1) var samp  : sampler;

struct VertIn {
  @location(0) clip_pos : vec2<f32>,
  @location(1) uv       : vec2<f32>,
  @location(2) tint     : vec4<f32>,
  @location(3) opacity  : f32,
}
struct VertOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv        : vec2<f32>,
  @location(1) tint      : vec4<f32>,
  @location(2) opacity   : f32,
}

@vertex
fn vs_text(in: VertIn) -> VertOut {
  var out: VertOut;
  out.pos     = vec4<f32>(in.clip_pos, 0.0, 1.0);
  out.uv      = in.uv;
  out.tint    = in.tint;
  out.opacity = in.opacity;
  return out;
}

@fragment
fn fs_text(in: VertOut) -> @location(0) vec4<f32> {
  let coverage = textureSample(atlas, samp, in.uv).a;
  let alpha    = coverage * in.tint.a * in.opacity;
  return vec4<f32>(in.tint.rgb * alpha, alpha); // premultiplied
}
`;

// ─── Glass material pass ──────────────────────────────────────────────────────

/**
 * Glass-surface shader.
 *
 * Vertex layout: same 36-byte layout as IMAGE_SHADER.
 *   uv      = local UV [0,1]×[0,1] within the glass node bounds
 *   tint    = unused (set to 0)
 *   opacity = node opacity
 *
 * @group(0): blurred backdrop texture + sampler
 * @group(1): GlassMaterial uniform (bind 0)
 *
 * The vertex shader also produces a `screen_uv` [0,1]×[0,1] from the
 * clip-space position so the glass can sample the backdrop at the
 * correct screen position.
 */
export const GLASS_SHADER = /* wgsl */ `
@group(0) @binding(0) var backdrop : texture_2d<f32>;
@group(0) @binding(1) var samp     : sampler;

struct GlassMat {
  tint          : vec4<f32>,
  opacity       : f32,
  saturation    : f32,
  noise_strength: f32,
  edge_hi_alpha : f32,
}
@group(1) @binding(0) var<uniform> mat: GlassMat;

struct VertIn {
  @location(0) clip_pos : vec2<f32>,
  @location(1) uv       : vec2<f32>,
  @location(2) tint     : vec4<f32>,
  @location(3) opacity  : f32,
}
struct VertOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv        : vec2<f32>,
  @location(1) screen_uv : vec2<f32>,
  @location(2) opacity   : f32,
}

@vertex
fn vs_glass(in: VertIn) -> VertOut {
  var out: VertOut;
  out.pos       = vec4<f32>(in.clip_pos, 0.0, 1.0);
  out.uv        = in.uv;
  // Convert clip space to [0,1]×[0,1] UV for backdrop sampling
  out.screen_uv = vec2<f32>((in.clip_pos.x + 1.0) * 0.5,
                             (1.0 - in.clip_pos.y) * 0.5);
  out.opacity   = in.opacity;
  return out;
}

fn hash2(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn saturate_color(c: vec3<f32>, s: f32) -> vec3<f32> {
  let lum = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
  return mix(vec3<f32>(lum), c, s);
}

@fragment
fn fs_glass(in: VertOut) -> @location(0) vec4<f32> {
  let bd = textureSample(backdrop, samp, in.screen_uv).rgb;

  // Saturation adjustment
  let sat = saturate_color(bd, mat.saturation);

  // Tint blend
  let tinted = mix(sat, mat.tint.rgb, mat.tint.a * 0.35);

  // Procedural surface noise
  let noise  = hash2(in.uv * vec2<f32>(300.0, 300.0));
  let noisy  = tinted + (noise - 0.5) * mat.noise_strength;

  // Edge highlight: brighten near border (uv distance from 0.5)
  let edge = 1.0 - 2.0 * length(in.uv - vec2<f32>(0.5));
  let hi   = clamp(edge * mat.edge_hi_alpha, 0.0, 1.0);
  let final_rgb = noisy + vec3<f32>(hi);

  let alpha = mat.opacity * in.opacity;
  return vec4<f32>(clamp(final_rgb, vec3<f32>(0.0), vec3<f32>(1.0)) * alpha, alpha);
}
`;

// ─── Gaussian blur (compute) ──────────────────────────────────────────────────

/**
 * Two-pass separable Gaussian blur compute shader.
 *
 * @group(0) binding 0: input  texture_2d<f32>
 * @group(0) binding 1: output texture_storage_2d<rgba8unorm, write>
 * @group(0) binding 2: BlurParams uniform
 *
 * Dispatch two passes:
 *   pass 1 – horizontal (params.horizontal = 1)
 *   pass 2 – vertical   (params.horizontal = 0)
 */
export const BLUR_COMPUTE_SHADER = /* wgsl */ `
struct BlurParams {
  radius    : u32,
  horizontal: u32,
  width     : u32,
  height    : u32,
}
@group(0) @binding(0) var input_tex  : texture_2d<f32>;
@group(0) @binding(1) var output_tex : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params : BlurParams;

@compute @workgroup_size(8, 8)
fn cs_blur(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  let w = i32(params.width);
  let h = i32(params.height);
  if x >= w || y >= h { return; }

  let r     = i32(params.radius);
  let sigma = max(f32(r) * 0.5, 0.5);

  var color      = vec4<f32>(0.0);
  var weight_sum = 0.0;

  for (var i = -r; i <= r; i++) {
    let w_val = exp(-0.5 * f32(i * i) / (sigma * sigma));
    var sp: vec2<i32>;
    if params.horizontal == 1u {
      sp = vec2<i32>(clamp(x + i, 0, w - 1), y);
    } else {
      sp = vec2<i32>(x, clamp(y + i, 0, h - 1));
    }
    color      += w_val * textureLoad(input_tex, sp, 0);
    weight_sum += w_val;
  }

  textureStore(output_tex, vec2<i32>(x, y), color / weight_sum);
}
`;

// ─── Color grade / tone-map post-process ──────────────────────────────────────

/**
 * Full-screen color-grade post-process.
 *
 * Uses a full-screen triangle (draw(3) with no vertex buffer).
 * @group(0): scene texture + sampler
 * @group(1): ColorGradeParams uniform
 */
export const COLOR_GRADE_SHADER = /* wgsl */ `
@group(0) @binding(0) var scene_tex : texture_2d<f32>;
@group(0) @binding(1) var samp      : sampler;

struct GradeParams {
  exposure         : f32,
  contrast         : f32,
  saturation       : f32,
  vignette_strength: f32,
}
@group(1) @binding(0) var<uniform> grade: GradeParams;

struct VertOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv        : vec2<f32>,
}

// Full-screen triangle: vertex_index in [0,2]
@vertex
fn vs_fullscreen(@builtin(vertex_index) vid: u32) -> VertOut {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  let p = positions[vid];
  var out: VertOut;
  out.pos = vec4<f32>(p, 0.0, 1.0);
  out.uv  = vec2<f32>((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
  return out;
}

fn aces_filmic(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = vec3<f32>(0.03);
  let c = 2.43;
  let d = vec3<f32>(0.59);
  let e = vec3<f32>(0.14);
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e),
               vec3<f32>(0.0), vec3<f32>(1.0));
}

fn adj_contrast(c: vec3<f32>, v: f32) -> vec3<f32> {
  return clamp((c - 0.5) * v + 0.5, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn adj_saturation(c: vec3<f32>, s: f32) -> vec3<f32> {
  let lum = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
  return mix(vec3<f32>(lum), c, s);
}

@fragment
fn fs_color_grade(in: VertOut) -> @location(0) vec4<f32> {
  var c = textureSample(scene_tex, samp, in.uv).rgb;

  // Undo premultiply (scene was rendered with premultiplied alpha; alpha is 1 here)
  // Apply exposure
  c = c * grade.exposure;

  // Tone map
  c = aces_filmic(c);

  // Contrast
  c = adj_contrast(c, grade.contrast);

  // Saturation
  c = adj_saturation(c, grade.saturation);

  // Vignette
  let vc    = in.uv - vec2<f32>(0.5);
  let vigf  = 1.0 - grade.vignette_strength * dot(vc, vc) * 4.0;
  c        *= max(vigf, 0.0);

  return vec4<f32>(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`;

// ─── Motion-blur accumulation ─────────────────────────────────────────────────

/**
 * Accumulates one sub-frame into a float16 accumulation texture.
 *
 * Uses a full-screen triangle.
 * @group(0): sub-frame texture + sampler
 * @group(1): weight uniform (f32, = 1/N)
 *
 * The render target for this pass uses additive blend so N calls with
 * weight 1/N each sum to the average sub-frame.
 */
export const ACCUM_SHADER = /* wgsl */ `
@group(0) @binding(0) var src  : texture_2d<f32>;
@group(0) @binding(1) var samp : sampler;

struct WeightUniform {
  weight: f32,
  _pad0 : f32,
  _pad1 : f32,
  _pad2 : f32,
}
@group(1) @binding(0) var<uniform> wu: WeightUniform;

struct VertOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv        : vec2<f32>,
}

@vertex
fn vs_fullscreen(@builtin(vertex_index) vid: u32) -> VertOut {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  let p = positions[vid];
  var out: VertOut;
  out.pos = vec4<f32>(p, 0.0, 1.0);
  out.uv  = vec2<f32>((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
  return out;
}

@fragment
fn fs_accum(in: VertOut) -> @location(0) vec4<f32> {
  let c = textureSample(src, samp, in.uv);
  return c * wu.weight;
}
`;

// ─── Simple blit (copy texture to another render target) ─────────────────────

/**
 * Plain full-screen blit.
 * Copies a texture to the current render target without any post-processing.
 */
export const BLIT_SHADER = /* wgsl */ `
@group(0) @binding(0) var src  : texture_2d<f32>;
@group(0) @binding(1) var samp : sampler;

struct VertOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv        : vec2<f32>,
}

@vertex
fn vs_fullscreen(@builtin(vertex_index) vid: u32) -> VertOut {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  let p = positions[vid];
  var out: VertOut;
  out.pos = vec4<f32>(p, 0.0, 1.0);
  out.uv  = vec2<f32>((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
  return out;
}

@fragment
fn fs_blit(in: VertOut) -> @location(0) vec4<f32> {
  return textureSample(src, samp, in.uv);
}
`;
