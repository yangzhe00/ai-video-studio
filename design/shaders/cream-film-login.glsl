/* @resolution */
uniform vec2 u_resolution;
/* @time */
uniform float u_time;

float grain(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 uv = gl_FragCoord.xy / vec2(1440.0, 900.0);
  float t = u_time * 0.12;
  vec3 base = mix(vec3(0.976, 0.952, 0.918), vec3(0.934, 0.887, 0.829), uv.x * 0.58 + uv.y * 0.14);
  float warm = exp(-dot((uv - vec2(0.38 + 0.18 * sin(t), 0.55 + 0.10 * cos(t * 0.7))) * vec2(1.9, 2.4),
                        (uv - vec2(0.38 + 0.18 * sin(t), 0.55 + 0.10 * cos(t * 0.7))) * vec2(1.9, 2.4)));
  float cool = exp(-dot((uv - vec2(0.20 + 0.10 * cos(t * 0.8), 0.12 + 0.08 * sin(t))) * vec2(2.2, 3.0),
                        (uv - vec2(0.20 + 0.10 * cos(t * 0.8), 0.12 + 0.08 * sin(t))) * vec2(2.2, 3.0)));
  float dust = (grain(floor(uv * u_resolution.xy * 0.55) + floor(u_time * 3.0)) - 0.5) * 0.022;
  vec3 color = base + vec3(0.12, 0.065, 0.025) * warm + vec3(-0.018, 0.035, 0.04) * cool + vec3(dust);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
