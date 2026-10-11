// GLSL ES 3.00 shaders

export const MAX_POINTS = 8;
export const MAX_RSPOTS = 3;

export const LIT_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
layout(location=3) in vec3 aColor;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform mat3 uNormalMat;
uniform mat4 uShadowMat;
uniform vec2 uUVScale;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUV;
out vec3 vColor;
out vec4 vShadow;
void main(){
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(uNormalMat * aNormal);
  vUV = aUV * uUVScale;
  vColor = aColor;
  vShadow = uShadowMat * w;
  gl_Position = uViewProj * w;
}`;

export const LIT_FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUV;
in vec3 vColor;
in vec4 vShadow;
uniform sampler2D uMap;
uniform sampler2DShadow uShadowMap;
uniform sampler2D uCookie;
uniform float uBump;
uniform vec3 uTint;
uniform vec3 uEmissive;
uniform float uEmMap;
uniform float uSpec;
uniform float uShin;
uniform int uAlphaMode;
uniform float uOpacity;
uniform vec3 uCamPos;
uniform vec3 uAmbient;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uSpotOn;
uniform vec3 uSpotPos;
uniform vec3 uSpotDir;
uniform vec3 uSpotColor;
uniform vec2 uSpotCone;
uniform float uSpotRange;
uniform float uShadowTexel;
uniform int uNumR;
uniform vec3 uRPos[${MAX_RSPOTS}];
uniform vec3 uRDir[${MAX_RSPOTS}];
uniform vec3 uRColor[${MAX_RSPOTS}];
uniform vec4 uRBox[${MAX_RSPOTS}];
uniform int uNumP;
uniform vec3 uPPos[${MAX_POINTS}];
uniform vec3 uPColor[${MAX_POINTS}];
uniform float uPRange[${MAX_POINTS}];
uniform vec4 uPBox[${MAX_POINTS}];
out vec4 outColor;

float boxMask(vec4 b, vec2 p){
  vec2 d = max(b.xy - p, p - b.zw);
  return 1.0 - smoothstep(0.0, 0.25, max(d.x, d.y));
}
float rangeAtt(float d, float r){
  float x = d / r;
  float f = clamp(1.0 - x*x*x*x, 0.0, 1.0);
  return f * f / (d * d * 0.5 + 1.0);
}
vec3 bumpN(vec3 sp, vec3 sn, float h){
  vec3 sx = dFdx(sp);
  vec3 sy = dFdy(sp);
  vec3 r1 = cross(sy, sn);
  vec3 r2 = cross(sn, sx);
  float det = dot(sx, r1);
  vec2 dh = vec2(dFdx(h), dFdy(h)) * uBump;
  vec3 g = sign(det) * (dh.x * r1 + dh.y * r2);
  return normalize(abs(det) * sn - g);
}
void main(){
  vec4 tex = texture(uMap, vUV);
  vec3 albedo = tex.rgb * vColor * uTint;
  vec3 N = normalize(vNormal);
  if(!gl_FrontFacing) N = -N;
  if(uBump > 0.0 && uAlphaMode == 0) N = bumpN(vWorld, N, tex.a);
  vec3 V = normalize(uCamPos - vWorld);
  vec3 lit = uAmbient * albedo;
  float ssum = 0.0;

  if(uSpotOn > 0.5){
    vec3 Lv = uSpotPos - vWorld;
    float d = length(Lv);
    vec3 L = Lv / d;
    float cone = smoothstep(uSpotCone.x, uSpotCone.y, dot(-L, uSpotDir));
    if(cone > 0.0 && d < uSpotRange){
      vec3 sc = vShadow.xyz / vShadow.w * 0.5 + 0.5;
      vec3 cookie = textureLod(uCookie, sc.xy, 0.0).rgb;
      float z = sc.z - 0.0004;
      float t = uShadowTexel;
      float sh = texture(uShadowMap, vec3(sc.xy, z));
      sh += texture(uShadowMap, vec3(sc.xy + vec2(t, t), z));
      sh += texture(uShadowMap, vec3(sc.xy + vec2(-t, t), z));
      sh += texture(uShadowMap, vec3(sc.xy + vec2(t, -t), z));
      sh += texture(uShadowMap, vec3(sc.xy + vec2(-t, -t), z));
      sh *= 0.2;
      float ndl = max(dot(N, L), 0.0);
      vec3 H = normalize(L + V);
      float sp = pow(max(dot(N, H), 0.0), uShin) * uSpec;
      float k = cone * sh * rangeAtt(d, uSpotRange) * ndl;
      lit += uSpotColor * cookie * k * (albedo + sp);
    }
  }
  for(int i = 0; i < ${MAX_RSPOTS}; i++){
    if(i >= uNumR) break;
    vec3 Lv = uRPos[i] - vWorld;
    float d = length(Lv);
    if(d > 18.0) continue;
    float m = boxMask(uRBox[i], vWorld.xz);
    if(m <= 0.0) continue;
    vec3 L = Lv / d;
    float cone = smoothstep(uSpotCone.x, uSpotCone.y, dot(-L, uRDir[i]));
    if(cone <= 0.0) continue;
    float ndl = max(dot(N, L), 0.0);
    vec3 H = normalize(L + V);
    float sp = pow(max(dot(N, H), 0.0), uShin) * uSpec;
    lit += uRColor[i] * cone * m * rangeAtt(d, 18.0) * ndl * (albedo + sp);
  }
  for(int i = 0; i < ${MAX_POINTS}; i++){
    if(i >= uNumP) break;
    vec3 Lv = uPPos[i] - vWorld;
    float d = length(Lv);
    if(d > uPRange[i]) continue;
    float m = boxMask(uPBox[i], vWorld.xz);
    if(m <= 0.0) continue;
    vec3 L = Lv / d;
    float ndl = max(dot(N, L), 0.0);
    vec3 H = normalize(L + V);
    float sp = pow(max(dot(N, H), 0.0), uShin) * uSpec;
    lit += uPColor[i] * m * rangeAtt(d, uPRange[i]) * ndl * (albedo + sp);
  }
  lit += uEmissive * mix(vec3(1.0), tex.rgb * tex.rgb, uEmMap);
  float dist = length(uCamPos - vWorld);
  float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
  lit = mix(lit, uFogColor, fog);
  float alpha = 1.0;
  if(uAlphaMode == 1) alpha = tex.a * uOpacity;
  else if(uAlphaMode == 2 && tex.a < 0.5) discard;
  outColor = vec4(lit, alpha);
}`;

export const DEPTH_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uModel;
uniform mat4 uViewProj;
void main(){ gl_Position = uViewProj * uModel * vec4(aPos, 1.0); }`;

export const DEPTH_FS = `#version 300 es
precision mediump float;
void main(){}`;

// Volumetric beam: additive cone
export const BEAM_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform mat3 uNormalMat;
out vec3 vWorld;
out vec3 vNormal;
out float vT;
void main(){
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(uNormalMat * aNormal);
  vT = aUV.y;
  gl_Position = uViewProj * w;
}`;

export const BEAM_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in float vT;
uniform vec3 uCamPos;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
out vec4 outColor;
void main(){
  vec3 V = normalize(uCamPos - vWorld);
  float edge = pow(abs(dot(normalize(vNormal), V)), 2.0);
  float fall = pow(1.0 - vT, 2.2) * smoothstep(0.0, 0.08, vT);
  float n = 0.75 + 0.25 * sin(vWorld.x * 3.1 + uTime * 0.7) * sin(vWorld.z * 2.7 - uTime * 0.5 + vWorld.y * 4.0);
  outColor = vec4(uColor * edge * fall * uIntensity * n, 1.0);
}`;

export const DUST_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
uniform vec3 uCenter;
uniform float uSize;
uniform float uTime;
uniform vec3 uSpotPos;
uniform vec3 uSpotDir;
uniform vec2 uSpotCone;
uniform float uSpotOn;
uniform float uPx;
out float vA;
void main(){
  vec3 p = aPos * uSize + vec3(sin(uTime * 0.13 + aPos.y * 20.0) * 0.4, -uTime * 0.03, cos(uTime * 0.11 + aPos.x * 20.0) * 0.4);
  vec3 lo = uCenter - vec3(uSize * 0.5);
  p = p - uSize * floor((p - lo) / uSize);
  vec3 L = p - uSpotPos;
  float d = length(L);
  float c = dot(L / max(d, 0.001), uSpotDir);
  float cone = smoothstep(uSpotCone.x, uSpotCone.y, c);
  vA = cone * uSpotOn * clamp(1.0 - d / 9.0, 0.0, 1.0) * (0.55 + 0.45 * sin(uTime * 1.7 + aPos.z * 60.0));
  vec4 cp = uViewProj * vec4(p, 1.0);
  gl_Position = cp;
  gl_PointSize = clamp(uPx * 0.012 / max(cp.w, 0.05), 1.0, 7.0);
}`;

export const DUST_FS = `#version 300 es
precision mediump float;
in float vA;
out vec4 outColor;
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = dot(q, q);
  if(r > 1.0) discard;
  outColor = vec4(vec3(1.0, 0.9, 0.75) * vA * (1.0 - r) * 0.55, 1.0);
}`;

export const FS_VS = `#version 300 es
out vec2 vUV;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uThreshold;
out vec4 outColor;
void main(){
  vec3 c = texture(uTex, vUV + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(uTex, vUV + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(uTex, vUV + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture(uTex, vUV + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(uThreshold, uThreshold + 1.5, l);
  outColor = vec4(min(c * k, vec3(40.0)), 1.0);
}`;

export const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uDir;
out vec4 outColor;
void main(){
  vec3 c = texture(uTex, vUV).rgb * 0.227027;
  c += texture(uTex, vUV + uDir * 1.3846).rgb * 0.316216;
  c += texture(uTex, vUV - uDir * 1.3846).rgb * 0.316216;
  c += texture(uTex, vUV + uDir * 3.2308).rgb * 0.070270;
  c += texture(uTex, vUV - uDir * 3.2308).rgb * 0.070270;
  outColor = vec4(c, 1.0);
}`;

export const COPY_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uTexel;
out vec4 outColor;
void main(){
  vec3 c = texture(uTex, vUV + uTexel * vec2(-0.5, -0.5)).rgb;
  c += texture(uTex, vUV + uTexel * vec2(0.5, -0.5)).rgb;
  c += texture(uTex, vUV + uTexel * vec2(-0.5, 0.5)).rgb;
  c += texture(uTex, vUV + uTexel * vec2(0.5, 0.5)).rgb;
  outColor = vec4(c * 0.25, 1.0);
}`;

export const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uScene;
uniform sampler2D uBloom1;
uniform sampler2D uBloom2;
uniform float uTime;
uniform float uExposure;
uniform float uBloomStr;
uniform float uCA;
uniform float uGrain;
uniform float uVignette;
uniform float uRed;
uniform float uFade;
uniform float uDistort;
uniform float uGamma;
uniform float uDesat;
uniform float uFlash;
uniform vec2 uRes;
out vec4 outColor;
vec3 aces(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 uv = vUV;
  if(uDistort > 0.0){
    uv += uDistort * vec2(sin(uv.y * 23.0 + uTime * 5.3), cos(uv.x * 19.0 + uTime * 4.1)) * 0.004;
    float band = step(0.985, fract(sin(floor(uv.y * 40.0 + uTime * 13.0) * 91.7) * 4371.3));
    uv.x += band * uDistort * 0.02;
  }
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);
  vec2 off = cc * uCA * (0.35 + r2 * 2.2) * 0.018;
  vec3 col;
  col.r = texture(uScene, uv + off).r;
  col.g = texture(uScene, uv).g;
  col.b = texture(uScene, uv - off).b;
  col += (texture(uBloom1, uv).rgb * 0.8 + texture(uBloom2, uv).rgb * 1.2) * uBloomStr;
  col *= uExposure;
  col = aces(col);
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(l), uDesat);
  col *= mix(vec3(0.88, 0.98, 1.06), vec3(1.06, 1.0, 0.9), smoothstep(0.0, 0.5, l));
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  col = pow(col, vec3(uGamma));
  float vig = smoothstep(0.95, 0.15, length(cc * vec2(1.0, 0.8)) * (1.0 + uVignette));
  col *= mix(1.0, vig, 0.9);
  col = mix(col, vec3(0.35, 0.0, 0.0) + col * 0.4, uRed * smoothstep(0.15, 0.85, length(cc) * 1.5));
  col += vec3(uFlash);
  float g = hash(uv * uRes + fract(uTime * 7.13) * 117.0) - 0.5;
  col += g * uGrain;
  col *= 1.0 - 0.035 * (0.5 + 0.5 * sin(uv.y * uRes.y * 1.4 + uTime * 30.0));
  col *= 1.0 - uFade;
  outColor = vec4(col, 1.0);
}`;
