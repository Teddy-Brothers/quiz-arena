import * as THREE from 'three';

export interface Entry { name: string; score: number; }

function label(text: string, sub: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  g.textAlign = 'center'; g.fillStyle = color;
  g.font = 'bold 64px system-ui, sans-serif'; g.fillText(text.slice(0, 12), 256, 110);
  g.font = '600 44px system-ui, sans-serif'; g.fillText(sub, 256, 180);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** 3D podium for the top three. Columns rise on entry; confetti falls unless reduced motion is set. */
export class PodiumScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  private cols: { mesh: THREE.Mesh; h: number; tag: THREE.Sprite }[] = [];
  private confetti: { m: THREE.Mesh; v: number; s: number }[] = [];
  private t0 = performance.now();
  private raf = 0;
  private disposed = false;
  private ro: ResizeObserver;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private canvas: HTMLCanvasElement, entries: Entry[], accent: string, dark: boolean) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.camera.position.set(0, 3.8, 10.5); this.camera.lookAt(0, 1.1, 0);
    this.scene.add(new THREE.AmbientLight(0xffffff, dark ? 0.7 : 0.95));
    const sun = new THREE.DirectionalLight(0xffffff, dark ? 1.1 : 1.3); sun.position.set(3, 8, 6); this.scene.add(sun);

    const floor = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.5, 0.15, 48), new THREE.MeshStandardMaterial({ color: dark ? 0x26262b : 0xdcd8d0, roughness: 0.9 }));
    floor.position.y = -0.08; this.scene.add(floor);

    const order = [1, 0, 2]; // silver left, gold centre, bronze right
    const heights = [2.6, 1.8, 1.2];
    const colors = [new THREE.Color(accent), new THREE.Color(0xc0c4cc), new THREE.Color(0xc88a55)];
    order.forEach((rank, slot) => {
      const e = entries[rank]; if (!e) return;
      const h = heights[rank];
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, h, 2), new THREE.MeshStandardMaterial({ color: colors[rank], roughness: 0.5 }));
      mesh.position.set((slot - 1) * 2.3, 0, 0);
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: label(e.name, `${e.score}`, dark ? '#ffffff' : '#1d1d1f'), transparent: true }));
      tag.scale.set(2.6, 1.3, 1);
      const num = new THREE.Sprite(new THREE.SpriteMaterial({ map: label(String(rank + 1), '', '#ffffff'), transparent: true }));
      num.scale.set(1.2, 0.6, 1); num.position.set(0, 0, 1.05); mesh.add(num);
      this.cols.push({ mesh, h, tag });
      this.scene.add(mesh, tag);
    });

    if (!this.reduced) {
      const pal = [accent, '#ffd166', '#7fe0c4', '#7fb4ff', '#ff8fab'];
      for (let i = 0; i < 70; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.02), new THREE.MeshBasicMaterial({ color: pal[i % pal.length] }));
        m.position.set((Math.random() - 0.5) * 8, 6 + Math.random() * 6, (Math.random() - 0.5) * 3);
        this.scene.add(m); this.confetti.push({ m, v: 0.6 + Math.random() * 1.2, s: Math.random() * 4 });
      }
    }

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement!);
    this.resize();
    this.loop();
  }

  dispose() {
    this.disposed = true; cancelAnimationFrame(this.raf); this.ro.disconnect();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => { (x as THREE.SpriteMaterial).map?.dispose(); x.dispose(); });
    });
    this.renderer.dispose();
  }

  private resize() {
    const p = this.canvas.parentElement!, w = p.clientWidth, h = p.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.position.z = w / h < 1 ? 14.5 : 10.5;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const t = (performance.now() - this.t0) / 1000;
    this.cols.forEach((c, i) => {
      const k = this.reduced ? 1 : Math.min(1, Math.max(0, (t - i * 0.25) / 1.1));
      const e = 1 - Math.pow(1 - k, 3);
      c.mesh.scale.y = Math.max(0.001, e); c.mesh.position.y = (c.h * e) / 2;
      c.tag.position.set(c.mesh.position.x, c.h * e + 0.9, 0);
    });
    this.confetti.forEach((c) => {
      c.m.position.y -= c.v * 0.03; c.m.rotation.x += 0.05; c.m.rotation.y += 0.03;
      c.m.position.x += Math.sin(t + c.s) * 0.004;
      if (c.m.position.y < 0.1) c.m.position.y = 6 + Math.random() * 3;
    });
    this.renderer.render(this.scene, this.camera);
  };
}
