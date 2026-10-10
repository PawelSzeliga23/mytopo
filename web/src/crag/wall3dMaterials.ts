import { useEffect, useState } from "react";
import * as THREE from "three";

/** Hologram colours: soft light-blue rock, neutral grey ground (as agreed after the plan 5a trial). */
export const ROCK_COLOR = "#9ec2db";
export const GROUND_COLOR = "#949494";

const vertexShader = /* glsl */ `
  attribute float depth;
  attribute float cls;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vDepth;
  varying float vGround;
  varying vec2 vUv;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    vDepth = depth;
    vGround = cls > 3.5 ? 1.0 : 0.0;
    vUv = uv;
    gl_Position = projectionMatrix * mv;
  }`;

/** Shaded relief with faint depth contours, muted on purpose: the routes are the bright elements. */
export function createHologramMaterial(rockColor: string | null = null, groundColor: string | null = null): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      rock: { value: new THREE.Color(rockColor ?? ROCK_COLOR) },
      ground: { value: new THREE.Color(groundColor ?? GROUND_COLOR) },
      levels: { value: 40 },
    },
    vertexShader,
    fragmentShader: /* glsl */ `
      uniform vec3 rock;
      uniform vec3 ground;
      uniform float levels;
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vDepth;
      varying float vGround;
      void main() {
        vec3 n = normalize(vNormal);
        if (!gl_FrontFacing) n = -n;
        float light = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);
        float rim = pow(1.0 - abs(dot(n, normalize(vView))), 2.0);
        float d = vDepth * levels;
        float line = 1.0 - min(abs(fract(d - 0.5) - 0.5) / fwidth(d), 1.0);
        vec3 lit = mix(rock, ground, vGround);
        vec3 color = mix(lit * 0.22, lit, light) + line * vec3(0.85, 0.93, 1.0) * 0.18 + rim * lit * 0.15;
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

export function createPhotoMaterial(photo: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { map: { value: photo } },
    vertexShader,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec2 vUv;
      void main() {
        gl_FragColor = vec4(texture2D(map, vUv).rgb, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/** The wall photo as a texture, loaded only when the photo look is on. */
export function usePhoto(url: string | null, enabled: boolean): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!enabled || !url) return;
    let current: THREE.Texture | null = null;
    new THREE.TextureLoader().load(url, (loaded) => {
      loaded.colorSpace = THREE.SRGBColorSpace;
      current = loaded;
      setTexture(loaded);
    });
    return () => current?.dispose();
  }, [url, enabled]);
  return texture;
}
