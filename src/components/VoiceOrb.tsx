import { useEffect, useRef } from "react";
import type { VoicePhase } from "../types";

type Props = {
  phase: VoicePhase;
  level?: number;
  className?: string;
};

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/** Translucent charcoal orb with bright speckles — see-through, not purple. */
const FRAG = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform vec2 u_res;
uniform float u_time;
uniform float u_level;
uniform float u_phase;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

vec2 flow(vec2 p, float t) {
  float n1 = fbm(p + vec2(t * 0.08, -t * 0.05));
  float n2 = fbm(p + vec2(-t * 0.06, t * 0.09) + 11.0);
  return vec2(n2 - 0.5, n1 - 0.5) * 0.55;
}

void main() {
  vec2 frag = v_uv * u_res;
  vec2 center = 0.5 * u_res;
  float minSide = min(u_res.x, u_res.y);

  float energy = clamp(u_level, 0.0, 1.0);
  float breath = 1.0 + energy * 0.03 + sin(u_time * 2.0) * 0.006;
  float radius = minSide * 0.44 * breath;

  vec2 d = frag - center;
  float nd = length(d) / max(radius, 1.0);

  if (nd > 1.08) {
    outColor = vec4(0.0);
    return;
  }

  float disc = 1.0 - smoothstep(0.92, 1.02, nd);
  float depth = smoothstep(1.0, 0.12, nd);

  float t = u_time;
  float think = step(1.5, u_phase) * (1.0 - step(2.5, u_phase));
  float speak = step(2.5, u_phase) * (1.0 - step(3.5, u_phase));
  float tempo = 0.45 + energy * 1.0 + think * 0.35 + speak * 0.55;

  vec2 p = d / radius;
  vec2 q = p * 1.5;
  q += flow(q, t * tempo * 0.4) * (0.16 + energy * 0.18);

  float smoke = smoothstep(0.28, 0.78, fbm(q * 2.3 + vec2(t * 0.04 * tempo, -t * 0.03)));

  // Soft charcoal haze with subtle purple wash
  vec3 body = vec3(0.08, 0.08, 0.11);
  body = mix(body, vec3(0.14, 0.12, 0.2), smoke * 0.55);
  body = mix(body, vec3(0.22, 0.16, 0.32), smoke * smoke * 0.28);

  float bodyA = mix(0.24, 0.55, smoke) * mix(0.42, 1.0, depth) * disc;
  bodyA *= 0.9 + energy * 0.12;

  // Soft rim — cool white with a touch of violet
  float rim = smoothstep(0.72, 0.94, nd) * (1.0 - smoothstep(0.96, 1.04, nd));
  body += vec3(0.72, 0.7, 0.9) * rim * 0.5;
  bodyA = max(bodyA, rim * 0.48 * disc);

  // Larger, brighter speckles
  vec3 fg = vec3(0.0);
  float fgA = 0.0;

  vec2 grid = (p * 0.5 + 0.5) * 28.0;
  vec2 cell = floor(grid);
  float h = hash(cell);

  if (h > 0.78) {
    vec2 f = fract(grid) - 0.5;
    float star = smoothstep(0.42, 0.0, length(f));
    float halo = smoothstep(0.55, 0.08, length(f)) * 0.35;
    float tw = 0.55 + 0.45 * sin(t * (1.8 + h * 5.0) + h * 28.0);
    float peak = h > 0.94 ? 1.7 : (h > 0.88 ? 1.35 : 1.05);
    float b = (star + halo) * tw * peak * (1.0 + energy * 0.5);
    vec3 c = vec3(b);
    // occasional soft purple tint on hotter speckles
    if (h > 0.88 && h < 0.96) c *= vec3(0.92, 0.84, 1.12);
    fg += c;
    fgA = max(fgA, clamp(b * 0.95, 0.0, 1.0));
  }

  if (h > 0.96) {
    vec2 f = fract(grid) - 0.5;
    float arm = max(
      smoothstep(0.06, 0.0, abs(f.x)) * smoothstep(0.48, 0.0, abs(f.y)),
      smoothstep(0.06, 0.0, abs(f.y)) * smoothstep(0.48, 0.0, abs(f.x))
    );
    float spark = arm * (1.1 + energy * 0.45);
    fg += vec3(spark) * vec3(0.95, 0.9, 1.08);
    fgA = max(fgA, clamp(spark, 0.0, 1.0));
  }

  float pulse = (0.045 + energy * 0.1) * (0.5 + 0.5 * sin(t * 3.0));
  body += vec3(0.52, 0.42, 0.72) * pulse * depth;
  bodyA = min(0.8, bodyA + pulse * 0.2);

  fg *= disc;
  fgA *= disc;

  vec3 premul = body * bodyA + fg * fgA;
  float alpha = clamp(bodyA + fgA * (1.0 - bodyA), 0.0, 1.0);
  outColor = vec4(premul, alpha);
}`;

function phaseToFloat(phase: VoicePhase) {
  switch (phase) {
    case "listening":
      return 1;
    case "thinking":
      return 2;
    case "speaking":
      return 3;
    case "error":
      return 4;
    default:
      return 0;
  }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("shader");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(info || "compile failed");
  }
  return sh;
}

export default function VoiceOrb({ phase, level = 0, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(phase);
  const levelRef = useRef(level);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
    });
    if (!gl) return;

    let disposed = false;
    let raf = 0;
    let smooth = 0;

    let vs: WebGLShader;
    let fs: WebGLShader;
    try {
      vs = compile(gl, gl.VERTEX_SHADER, VERT);
      fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    } catch (err) {
      console.error(err);
      return;
    }

    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "u_res");
    const uTime = gl.getUniformLocation(prog, "u_time");
    const uLevel = gl.getUniformLocation(prog, "u_level");
    const uPhase = gl.getUniformLocation(prog, "u_phase");

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    const frame = (now: number) => {
      if (disposed) return;
      resize();
      smooth += (Math.min(1, Math.max(0, levelRef.current)) - smooth) * 0.16;

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, now * 0.001);
      gl.uniform1f(uLevel, smooth);
      gl.uniform1f(uPhase, phaseToFloat(phaseRef.current));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
