// Custom WebGL2 forward renderer: shadowed flashlight, pooled point lights, fog, HDR bloom + horror post FX.
import { mat4, frustumPlanes, aabbInFrustum } from '../math.js';
import * as S from './shaders.js';

const IDENT = mat4.create();
const IDENT3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

export const QUALITY = {
  low: { scale: 0.6, msaa: 0, shadow: 512, dust: 250, maxDpr: 1 },
  medium: { scale: 0.85, msaa: 0, shadow: 1024, dust: 500, maxDpr: 1.25 },
  high: { scale: 1.0, msaa: 4, shadow: 2048, dust: 800, maxDpr: 1.5 },
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: true, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 is not supported by this browser.');
    this.gl = gl;
    this.extCBF = gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.extAniso = gl.getExtension('EXT_texture_filter_anisotropic');
    this.maxAniso = this.extAniso ? gl.getParameter(this.extAniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
    this.hdr = !!this.extCBF;
    this.fmt = this.hdr ? gl.RGBA16F : gl.RGBA8;

    this.lit = this.compile(S.LIT_VS, S.LIT_FS);
    this.depth = this.compile(S.DEPTH_VS, S.DEPTH_FS);
    this.beam = this.compile(S.BEAM_VS, S.BEAM_FS);
    this.dust = this.compile(S.DUST_VS, S.DUST_FS);
    this.bright = this.compile(S.FS_VS, S.BRIGHT_FS);
    this.blur = this.compile(S.FS_VS, S.BLUR_FS);
    this.copy = this.compile(S.FS_VS, S.COPY_FS);
    this.comp = this.compile(S.FS_VS, S.COMPOSITE_FS);
    this.emptyVao = gl.createVertexArray();

    this.white = this.createTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, { mips: false });
    this.planes = new Array(6);
    this.lplanes = new Array(6);
    this.viewProj = mat4.create();
    this.stats = { draws: 0 };
    this.quality = null;
    this.w = 0; this.h = 0;
    this.setQuality('medium');
  }

  compile(vsSrc, fsSrc) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        console.error(src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
        throw new Error('Shader compile error: ' + log);
      }
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program link error: ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  createMesh(md) {
    const gl = this.gl;
    const n = md.vcount;
    const data = new Float32Array(n * 11);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      const o = i * 11;
      for (let k = 0; k < 3; k++) {
        const v = md.p[i * 3 + k];
        data[o + k] = v;
        if (v < mn[k]) mn[k] = v;
        if (v > mx[k]) mx[k] = v;
        data[o + 3 + k] = md.n[i * 3 + k];
        data[o + 8 + k] = md.c[i * 3 + k];
      }
      data[o + 6] = md.t[i * 2];
      data[o + 7] = md.t[i * 2 + 1];
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const st = 44;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, st, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, st, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, st, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, st, 32);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(md.i), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, vbo, ibo, count: md.i.length, min: mn, max: mx };
  }

  deleteMesh(m) {
    const gl = this.gl;
    if (!m) return;
    gl.deleteVertexArray(m.vao);
    gl.deleteBuffer(m.vbo);
    gl.deleteBuffer(m.ibo);
  }

  createPoints(arr) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);
    return { vao, count: arr.length / 3 };
  }

  createTexture(data, w, h, { srgb = true, repeat = true, mips = true, aniso = 8 } = {}) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (mips) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      if (this.extAniso && aniso > 1)
        gl.texParameterf(gl.TEXTURE_2D, this.extAniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(aniso, this.maxAniso));
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    return t;
  }

  setQuality(name) {
    this.qname = QUALITY[name] ? name : 'medium';
    this.quality = QUALITY[this.qname];
    this._createShadow(this.quality.shadow);
    this.w = 0;
    this.resize();
  }

  _createShadow(size) {
    const gl = this.gl;
    if (this.shadowTex) { gl.deleteTexture(this.shadowTex); gl.deleteFramebuffer(this.shadowFbo); }
    this.shadowSize = size;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.shadowTex = t;
    this.shadowFbo = f;
  }

  _colorTex(w, h) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, this.fmt, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  _target(w, h, depth) {
    const gl = this.gl;
    const tex = this._colorTex(w, h);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let rb = null;
    if (depth) {
      rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    }
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, rb, w, h, ok };
  }
  _freeTarget(t) {
    if (!t) return;
    const gl = this.gl;
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fbo);
    if (t.rb) gl.deleteRenderbuffer(t.rb);
  }

  resize() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.maxDpr);
    const cw = Math.max(2, Math.floor(this.canvas.clientWidth * dpr));
    const ch = Math.max(2, Math.floor(this.canvas.clientHeight * dpr));
    if (cw === this.canvas.width && ch === this.canvas.height && this.w) return;
    this.canvas.width = cw;
    this.canvas.height = ch;
    const w = Math.max(2, Math.floor(cw * this.quality.scale));
    const h = Math.max(2, Math.floor(ch * this.quality.scale));
    this.w = w; this.h = h;
    for (const k of ['scene', 'hA', 'hB', 'qA', 'qB']) this._freeTarget(this[k]);
    if (this.ms) { gl.deleteFramebuffer(this.ms.fbo); gl.deleteRenderbuffer(this.ms.c); gl.deleteRenderbuffer(this.ms.d); this.ms = null; }
    this.scene = this._target(w, h, true);
    if (!this.scene.ok && this.hdr) {
      // fall back to LDR
      this.hdr = false;
      this.fmt = gl.RGBA8;
      this._freeTarget(this.scene);
      this.scene = this._target(w, h, true);
    }
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    const qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
    this.hA = this._target(hw, hh, false);
    this.hB = this._target(hw, hh, false);
    this.qA = this._target(qw, qh, false);
    this.qB = this._target(qw, qh, false);
    const samples = Math.min(this.quality.msaa, gl.getParameter(gl.MAX_SAMPLES) || 0);
    if (samples > 1) {
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      const c = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, c);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, this.fmt, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, c);
      const d = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, d);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, d);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) this.ms = { fbo, c, d };
      else { gl.deleteFramebuffer(fbo); gl.deleteRenderbuffer(c); gl.deleteRenderbuffer(d); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  _setMaterial(u, mat) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, mat.map || this.white);
    gl.uniform1f(u.uBump, mat.bump || 0);
    gl.uniform3fv(u.uTint, mat.tint || [1, 1, 1]);
    gl.uniform3fv(u.uEmissive, mat.emissive || [0, 0, 0]);
    gl.uniform1f(u.uEmMap, mat.emMap || 0);
    gl.uniform1f(u.uSpec, mat.spec ?? 0.2);
    gl.uniform1f(u.uShin, mat.shin ?? 24);
    gl.uniform1i(u.uAlphaMode, mat.alpha || 0);
    gl.uniform1f(u.uOpacity, mat.opacity ?? 1);
    gl.uniform2fv(u.uUVScale, mat.uvScale || [1, 1]);
    if (mat.double) gl.disable(gl.CULL_FACE);
    else gl.enable(gl.CULL_FACE);
  }

  _visible(item, planes, cam, maxDist) {
    if (item.model) return true;
    const m = item.mesh;
    if (!aabbInFrustum(planes, m.min, m.max)) return false;
    // distance from camera to box
    const dx = Math.max(m.min[0] - cam[0], 0, cam[0] - m.max[0]);
    const dy = Math.max(m.min[1] - cam[1], 0, cam[1] - m.max[1]);
    const dz = Math.max(m.min[2] - cam[2], 0, cam[2] - m.max[2]);
    return dx * dx + dy * dy + dz * dz < maxDist * maxDist;
  }

  render(f) {
    const gl = this.gl;
    this.resize();
    this.stats.draws = 0;
    const spot = f.spot;
    const nm = new Float32Array(9);

    // ---------- Shadow pass ----------
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    if (spot && spot.on) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.FRONT);
      gl.useProgram(this.depth.p);
      gl.uniformMatrix4fv(this.depth.u.uViewProj, false, spot.viewProj);
      frustumPlanes(spot.viewProj, this.lplanes);
      for (const it of f.opaque) {
        if (it.shadow === false) continue;
        if (!this._visible(it, this.lplanes, spot.pos, spot.range + 2)) continue;
        gl.uniformMatrix4fv(this.depth.u.uModel, false, it.model || IDENT);
        gl.bindVertexArray(it.mesh.vao);
        gl.drawElements(gl.TRIANGLES, it.mesh.count, gl.UNSIGNED_INT, 0);
      }
      gl.cullFace(gl.BACK);
    }

    // ---------- Scene pass ----------
    const target = this.ms ? this.ms.fbo : this.scene.fbo;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, this.w, this.h);
    const fc = f.fogColor;
    gl.clearColor(fc[0], fc[1], fc[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);

    const L = this.lit;
    const u = L.u;
    gl.useProgram(L.p);
    gl.uniformMatrix4fv(u.uViewProj, false, f.viewProj);
    gl.uniform3fv(u.uCamPos, f.camPos);
    gl.uniform3fv(u.uAmbient, f.ambient);
    gl.uniform3fv(u.uFogColor, f.fogColor);
    gl.uniform1f(u.uFogDensity, f.fogDensity);
    gl.uniform1i(u.uMap, 0);
    gl.uniform1i(u.uShadowMap, 1);
    gl.uniform1i(u.uCookie, 2);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, f.cookie || this.white);
    gl.uniform1f(u.uShadowTexel, 1.0 / this.shadowSize);
    gl.uniform2fv(u.uSpotCone, f.spotCone || [0.9, 0.97]);
    if (spot && spot.on) {
      gl.uniform1f(u.uSpotOn, 1);
      gl.uniform3fv(u.uSpotPos, spot.pos);
      gl.uniform3fv(u.uSpotDir, spot.dir);
      gl.uniform3fv(u.uSpotColor, spot.color);
      gl.uniform1f(u.uSpotRange, spot.range);
      gl.uniformMatrix4fv(u.uShadowMat, false, spot.viewProj);
    } else {
      gl.uniform1f(u.uSpotOn, 0);
      gl.uniformMatrix4fv(u.uShadowMat, false, IDENT);
    }
    // remote spots
    const rs = f.rspots || [];
    const nr = Math.min(rs.length, S.MAX_RSPOTS);
    gl.uniform1i(u.uNumR, nr);
    if (nr) {
      const P = new Float32Array(S.MAX_RSPOTS * 3), D = new Float32Array(S.MAX_RSPOTS * 3), C = new Float32Array(S.MAX_RSPOTS * 3), B = new Float32Array(S.MAX_RSPOTS * 4);
      for (let i = 0; i < nr; i++) {
        P.set(rs[i].pos, i * 3); D.set(rs[i].dir, i * 3); C.set(rs[i].color, i * 3); B.set(rs[i].box, i * 4);
      }
      gl.uniform3fv(u.uRPos, P); gl.uniform3fv(u.uRDir, D); gl.uniform3fv(u.uRColor, C); gl.uniform4fv(u.uRBox, B);
    }
    const ps = f.points || [];
    const np = Math.min(ps.length, S.MAX_POINTS);
    gl.uniform1i(u.uNumP, np);
    if (np) {
      const P = new Float32Array(S.MAX_POINTS * 3), C = new Float32Array(S.MAX_POINTS * 3), R = new Float32Array(S.MAX_POINTS), B = new Float32Array(S.MAX_POINTS * 4);
      for (let i = 0; i < np; i++) {
        P.set(ps[i].pos, i * 3); C.set(ps[i].color, i * 3); R[i] = ps[i].range; B.set(ps[i].box, i * 4);
      }
      gl.uniform3fv(u.uPPos, P); gl.uniform3fv(u.uPColor, C); gl.uniform1fv(u.uPRange, R); gl.uniform4fv(u.uPBox, B);
    }

    frustumPlanes(f.viewProj, this.planes);
    const maxD = f.drawDist || 40;
    let lastMat = null;
    const drawList = (list) => {
      for (const it of list) {
        if (!this._visible(it, this.planes, f.camPos, maxD)) continue;
        if (it.mat !== lastMat) { this._setMaterial(u, it.mat); lastMat = it.mat; }
        if (it.model) {
          gl.uniformMatrix4fv(u.uModel, false, it.model);
          mat4.normalMat3(nm, it.model);
          gl.uniformMatrix3fv(u.uNormalMat, false, nm);
        } else {
          gl.uniformMatrix4fv(u.uModel, false, IDENT);
          gl.uniformMatrix3fv(u.uNormalMat, false, IDENT3);
        }
        if (it.emissive) gl.uniform3fv(u.uEmissive, it.emissive);
        gl.bindVertexArray(it.mesh.vao);
        gl.drawElements(gl.TRIANGLES, it.mesh.count, gl.UNSIGNED_INT, 0);
        if (it.emissive) gl.uniform3fv(u.uEmissive, it.mat.emissive || [0, 0, 0]);
        this.stats.draws++;
      }
    };
    drawList(f.opaque);

    // decals (alpha blended)
    if (f.decals && f.decals.length) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1, -4);
      lastMat = null;
      drawList(f.decals);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // additive volumetrics
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    if (f.beams && f.beams.length) {
      gl.disable(gl.CULL_FACE);
      gl.useProgram(this.beam.p);
      const bu = this.beam.u;
      gl.uniformMatrix4fv(bu.uViewProj, false, f.viewProj);
      gl.uniform3fv(bu.uCamPos, f.camPos);
      gl.uniform1f(bu.uTime, f.time);
      for (const b of f.beams) {
        gl.uniformMatrix4fv(bu.uModel, false, b.model);
        mat4.normalMat3(nm, b.model);
        gl.uniformMatrix3fv(bu.uNormalMat, false, nm);
        gl.uniform3fv(bu.uColor, b.color);
        gl.uniform1f(bu.uIntensity, b.intensity);
        gl.bindVertexArray(b.mesh.vao);
        gl.drawElements(gl.TRIANGLES, b.mesh.count, gl.UNSIGNED_INT, 0);
      }
      gl.enable(gl.CULL_FACE);
    }
    if (f.dust && spot && spot.on) {
      const d = f.dust;
      gl.useProgram(this.dust.p);
      const du = this.dust.u;
      gl.uniformMatrix4fv(du.uViewProj, false, f.viewProj);
      gl.uniform3fv(du.uCenter, f.camPos);
      gl.uniform1f(du.uSize, d.size);
      gl.uniform1f(du.uTime, f.time);
      gl.uniform3fv(du.uSpotPos, spot.pos);
      gl.uniform3fv(du.uSpotDir, spot.dir);
      gl.uniform2fv(du.uSpotCone, f.spotCone);
      gl.uniform1f(du.uSpotOn, d.intensity);
      gl.uniform1f(du.uPx, this.h);
      gl.bindVertexArray(d.mesh.vao);
      gl.drawArrays(gl.POINTS, 0, Math.min(d.mesh.count, this.quality.dust));
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // resolve MSAA
    if (this.ms) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.ms.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.scene.fbo);
      gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }

    // ---------- Post ----------
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.emptyVao);
    const pass = (prog, target, setup) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
      gl.viewport(0, 0, target ? target.w : this.canvas.width, target ? target.h : this.canvas.height);
      gl.useProgram(prog.p);
      setup(prog.u);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const bindTex = (unit, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); };
    const P = f.post;
    pass(this.bright, this.hA, (uu) => {
      bindTex(0, this.scene.tex); gl.uniform1i(uu.uTex, 0);
      gl.uniform2f(uu.uTexel, 1 / this.w, 1 / this.h);
      gl.uniform1f(uu.uThreshold, this.hdr ? 1.0 : 0.7);
    });
    pass(this.blur, this.hB, (uu) => { bindTex(0, this.hA.tex); gl.uniform1i(uu.uTex, 0); gl.uniform2f(uu.uDir, 1 / this.hA.w, 0); });
    pass(this.blur, this.hA, (uu) => { bindTex(0, this.hB.tex); gl.uniform1i(uu.uTex, 0); gl.uniform2f(uu.uDir, 0, 1 / this.hA.h); });
    pass(this.copy, this.qA, (uu) => { bindTex(0, this.hA.tex); gl.uniform1i(uu.uTex, 0); gl.uniform2f(uu.uTexel, 1 / this.hA.w, 1 / this.hA.h); });
    pass(this.blur, this.qB, (uu) => { bindTex(0, this.qA.tex); gl.uniform1i(uu.uTex, 0); gl.uniform2f(uu.uDir, 1 / this.qA.w, 0); });
    pass(this.blur, this.qA, (uu) => { bindTex(0, this.qB.tex); gl.uniform1i(uu.uTex, 0); gl.uniform2f(uu.uDir, 0, 1 / this.qA.h); });
    pass(this.comp, null, (uu) => {
      bindTex(0, this.scene.tex); gl.uniform1i(uu.uScene, 0);
      bindTex(1, this.hA.tex); gl.uniform1i(uu.uBloom1, 1);
      bindTex(2, this.qA.tex); gl.uniform1i(uu.uBloom2, 2);
      gl.uniform1f(uu.uTime, f.time);
      gl.uniform1f(uu.uExposure, P.exposure);
      gl.uniform1f(uu.uBloomStr, P.bloom);
      gl.uniform1f(uu.uCA, P.ca);
      gl.uniform1f(uu.uGrain, P.grain);
      gl.uniform1f(uu.uVignette, P.vignette);
      gl.uniform1f(uu.uRed, P.red);
      gl.uniform1f(uu.uFade, P.fade);
      gl.uniform1f(uu.uDistort, P.distort);
      gl.uniform1f(uu.uGamma, P.gamma);
      gl.uniform1f(uu.uDesat, P.desat);
      gl.uniform1f(uu.uFlash, P.flash || 0);
      gl.uniform2f(uu.uRes, this.canvas.width, this.canvas.height);
    });
    gl.bindVertexArray(null);
  }
}
