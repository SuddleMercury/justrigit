import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { processClip } from '../core/clips.js';

export class Viewport {
  constructor(container, forge) {
    this.forge = forge;
    this.container = container;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(r.domElement);

    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x14171d);
    s.fog = new THREE.Fog(0x14171d, 12, 40);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
    this.camera.position.set(2.2, 1.6, 3.4);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.target.set(0, 0.9, 0);
    this.controls.enableDamping = true;

    s.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2420, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(3, 6, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 20 });
    s.add(sun);
    const rim = new THREE.DirectionalLight(0xff9a4a, 0.8);
    rim.position.set(-4, 3, -4);
    s.add(rim);

    const ground = this.ground = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    s.add(ground);
    this.grid = new THREE.GridHelper(20, 40, 0x3a4150, 0x262b35);
    this.grid.position.y = 0.001;
    s.add(this.grid);

    // "Forward" arrow so beginners can see which way is front.
    this.arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.01, 0.35), 0.5, 0xff7a1a, 0.12, 0.08);
    s.add(this.arrow);

    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 500);
    this.rigMode = false;
    this.centerLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]), new THREE.LineDashedMaterial({ color: 0xff7a1a, dashSize: 0.04, gapSize: 0.03, transparent: true, opacity: 0.5 }));
    this.centerLine.visible = false;
    s.add(this.centerLine);
    this.onRender = null;
    this.mixer = null;
    this.action = null;
    this.skelHelper = null;
    this.showSkeleton = false;
    this.paused = false;
    this.clock = new THREE.Clock();
    this.onTime = null;

    forge.hooks.snapshot = () => { this.render(); return r.domElement.toDataURL('image/png'); };
    forge.on((type, data) => {
      if (type === 'doc') this.setDoc(data);
      if (type === 'play') this.play(data);
    });
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.loop();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.rigMode && this.forge.doc) this.frameOrtho(this.forge.doc);
  }

  // Front orthographic view for placing auto-rig markers.
  setRigMode(on) {
    this.rigMode = on;
    this.controls.enabled = !on;
    this.arrow.visible = !on;
    this.centerLine.visible = on;
    if (on && this.forge.doc) this.frameOrtho(this.forge.doc);
  }
  frameOrtho(doc) {
    const m = doc.metrics, H = Math.max(0.1, m.height);
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    const viewH = H * 1.18, viewW = viewH * (w / h);
    const cx = m.center[0], cy = m.minY + H / 2;
    Object.assign(this.ortho, { left: -viewW / 2, right: viewW / 2, top: viewH / 2, bottom: -viewH / 2, near: 0.01, far: H * 20 + 10 });
    this.ortho.position.set(cx, cy, H * 5 + 2);
    this.ortho.lookAt(cx, cy, 0);
    this.ortho.updateProjectionMatrix();
    this.ortho.updateMatrixWorld();
    this.centerLine.geometry.setFromPoints([new THREE.Vector3(cx, m.minY - H * 0.02, H * 2), new THREE.Vector3(cx, m.minY + H * 1.04, H * 2)]);
    this.centerLine.computeLineDistances();
    this.orthoCenterX = cx;
  }
  project(x, y) {
    const v = new THREE.Vector3(x, y, 0).project(this.ortho);
    return [(v.x + 1) / 2 * this.container.clientWidth, (1 - v.y) / 2 * this.container.clientHeight];
  }
  unproject(px, py) {
    const v = new THREE.Vector3((px / this.container.clientWidth) * 2 - 1, -(py / this.container.clientHeight) * 2 + 1, 0).unproject(this.ortho);
    return [v.x, v.y];
  }

  setDoc(doc) {
    if (this.current && this.current !== doc.root) this.scene.remove(this.current);
    if (this.skelHelper) { this.scene.remove(this.skelHelper); this.skelHelper = null; }
    if (this.mixer) this.mixer.stopAllAction();
    this.current = doc.root;
    this.scene.add(doc.root);
    doc.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    doc.restPose();
    this.mixer = new THREE.AnimationMixer(doc.root);
    this.action = null;
    this.skelHelper = new THREE.SkeletonHelper(doc.root);
    this.skelHelper.visible = this.showSkeleton;
    this.skelHelper.material.depthTest = false;
    this.skelHelper.material.transparent = true;
    this.skelHelper.renderOrder = 10;
    this.scene.add(this.skelHelper);
    this.frame(doc);
    if (this.rigMode) this.frameOrtho(doc);
    if (this.forge.playing && !String(this.forge.playing).startsWith('library:')) this.play(this.forge.playing);
  }

  frame(doc) {
    const h = Math.max(0.2, doc.metrics.height || 1.8);
    const c = doc.metrics.center;
    const cy = h * 0.5 + doc.metrics.minY;
    this.controls.target.set(c[0] || 0, isFinite(cy) ? cy : 0.9, c[2] || 0);
    const dist = Math.min(Math.max(h * 2.2, 1.2), 20000);
    this.camera.position.set(this.controls.target.x + dist * 0.55, this.controls.target.y + h * 0.25, this.controls.target.z + dist * 0.85);
    this.camera.near = Math.max(0.005, dist / 500);
    this.camera.far = Math.max(200, dist * 20);
    // Scale the haze, floor and grid with the character, so big (or tiny) models never disappear.
    this.scene.fog.near = dist * 3;
    this.scene.fog.far = dist * 12;
    const gs = Math.max(1, dist / 4);
    this.ground.scale.setScalar(gs);
    this.grid.scale.setScalar(gs);
    this.camera.updateProjectionMatrix();
    const sc = Math.max(0.3, Math.min(h / 1.8, 5000));
    this.arrow.scale.setScalar(sc);
    this.arrow.position.set(0, 0.01, 0.35 * sc);
  }

  play(arg) {
    const f = this.forge, doc = f.doc;
    if (!doc || !this.mixer) return;
    this.mixer.stopAllAction();
    if (this.action) this.mixer.uncacheAction(this.action.getClip());
    this.action = null;
    doc.restPose();
    if (!arg) return;
    let clip, mode;
    if (typeof arg === 'object') { clip = arg.clip; mode = f.options.motion; }
    else {
      clip = doc.findClip(arg);
      if (!clip) return;
      mode = f.options.clipModes[doc.clipName(clip)] || f.options.motion;
    }
    const processed = processClip(doc, clip, mode, clip.name + '_preview');
    this.action = this.mixer.clipAction(processed);
    this.action.play();
    this.paused = false;
  }

  togglePause() { this.paused = !this.paused; return this.paused; }
  setSkeleton(v) { this.showSkeleton = v; if (this.skelHelper) this.skelHelper.visible = v; }
  seek(fraction) {
    if (!this.action) return;
    this.action.time = fraction * this.action.getClip().duration;
    this.mixer.update(0);
  }

  render() {
    this.renderer.render(this.scene, this.rigMode ? this.ortho : this.camera);
    if (this.onRender) this.onRender();
  }

  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (this.mixer && this.action && !this.paused) this.mixer.update(dt);
    if (this.onTime) this.onTime(this.action ? this.action.time / (this.action.getClip().duration || 1) : null, this.action);
    this.controls.update();
    this.render();
  }
}
